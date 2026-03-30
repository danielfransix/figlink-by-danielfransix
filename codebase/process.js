#!/usr/bin/env node

const fs = require('fs');
const WebSocket = require('./link-server/node_modules/ws');
const { randomUUID } = require('crypto');
const { execSync } = require('child_process');

// Configuration
const WS_URL = 'ws://localhost:9001';

// --- WebSocket Helper ---
async function sendCommand(command, params, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const id = randomUUID();

        let done = false;
        const timeout = setTimeout(() => {
            if (!done) {
                ws.close();
                reject(new Error('Timeout — is the Figlink server running and plugin connected?'));
            }
        }, timeoutMs);

        ws.on('open', () => {
            ws.send(JSON.stringify({ id, command, params }));
        });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch (e) {
                done = true;
                clearTimeout(timeout);
                reject(new Error('Malformed JSON from Figlink server'));
                return;
            }
            if (msg.id !== id) return;
            done = true;
            clearTimeout(timeout);
            ws.close();
            
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result);
        });

        ws.on('error', (e) => {
            if (!done) {
                done = true;
                clearTimeout(timeout);
                reject(e);
            }
        });
    });
}

// --- Data Fetching ---
async function fetchDocumentData() {
    console.log('Fetching document variables and styles (including libraries)...');
    const variables = await sendCommand('get_all_available_variables', {}, 300000);
    const styles = await sendCommand('get_local_styles', {});
    return { variables, styles };
}

async function fetchNodes(nodeId) {
    console.log(`Fetching nodes for frame ${nodeId}...`);
    return await sendCommand('get_nodes_flat', { nodeId, skipVectors: true, skipInstanceChildren: true });
}

async function fetchNodeTree(nodeId) {
    console.log(`Fetching node tree for frame ${nodeId}...`);
    return await sendCommand('get_nodes', { nodeId, depth: 10 });
}

// --- Processing Logic ---

// Find closest color variable
function findClosestColor(r, g, b, colorVars) {
    let closest = null;
    let minDiff = Infinity;
    
    for (const v of colorVars) {
        const c = Object.values(v.valuesByMode)[0];
        if (!c) continue;
        const vr = Math.round(c.r * 255);
        const vg = Math.round(c.g * 255);
        const vb = Math.round(c.b * 255);
        
        const diff = Math.abs(vr - r) + Math.abs(vg - g) + Math.abs(vb - b);
        if (diff < minDiff) {
            minDiff = diff;
            closest = v;
        }
    }
    return closest;
}

// Find closest float variable (spacing/radius)
function findClosestFloat(val, type, floatVars) {
    if (val === null || val === undefined) return null;
    const candidates = floatVars.filter(v => v.name.startsWith(`${type}/`));
    let closest = null;
    let minDiff = Infinity;
    for (const c of candidates) {
        const diff = Math.abs(c.val - val);
        if (diff < minDiff) {
            minDiff = diff;
            closest = c;
        }
    }
    
    // Do not force a non-zero variable onto a 0 value
    // This prevents adding unwanted padding/radius
    if (val === 0 && closest && closest.val !== 0) {
        return null;
    }
    
    return closest;
}

// Find closest text style
function findClosestTextStyle(fontSize, fontWeight, fontFamily, textStyles) {
    let closest = null;
    let minDiff = Infinity;
    
    const weightMap = {
        'Regular': 400, 'Book': 400, 'Normal': 400,
        'Medium': 500,
        'SemiBold': 600, 'Semibold': 600,
        'Bold': 700,
        'ExtraBold': 800, 'Black': 900
    };
    
    const targetWeight = weightMap[fontWeight] || 400;
    
    for (const style of textStyles) {
        if (!style.fontSize) continue;
        
        if (style.fontSize === fontSize && style.fontWeight === fontWeight) {
            return style;
        }
        
        const styleWeight = weightMap[style.fontWeight] || 400;
        const sizeDiff = Math.abs(style.fontSize - fontSize) * 10;
        const weightDiff = Math.abs(styleWeight - targetWeight) / 100;
        const totalDiff = sizeDiff + weightDiff;
        
        if (totalDiff < minDiff) {
            minDiff = totalDiff;
            closest = style;
        }
    }
    return closest;
}

function getFirstText(nodeId, nodes) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;
    if (node.type === 'TEXT') return node.text;
    if (node.children) {
        for (const child of node.children) {
            const t = getFirstText(child.id, nodes);
            if (t) return t;
        }
    }
    return null;
}

// Process all standardization rules
async function processStandardization(nodeId, prefetched = null) {
    try {
        const { variables, styles } = prefetched || await fetchDocumentData();
        const nodes = await fetchNodes(nodeId);
        
        const colorVars = variables.filter(v => v.resolvedType === 'COLOR');
        const floatVars = variables.filter(v => v.resolvedType === 'FLOAT').map(v => ({...v, val: Object.values(v.valuesByMode)[0]}));
        const textStyles = styles.textStyles || [];

        const renameItems = [];
        const colorItems = [];
        const bindingItems = [];
        const textStyleItems = [];
        const propertyItems = []; // For clip content
        
        const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'];
        const radiusFields = ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];

        nodes.forEach(n => {
            // 1. Renaming
            if (n.type === 'TEXT' && n.text) {
                let newName = n.text.trim().substring(0, 30);
                if (newName && n.name !== newName) renameItems.push({ nodeId: n.id, name: newName });
            } else if (n.type === 'FRAME') {
                const t = getFirstText(n.id, nodes);
                if (t) {
                    let newName = t.trim().substring(0, 30);
                    if (newName && n.name !== newName && n.name.startsWith('Frame')) renameItems.push({ nodeId: n.id, name: newName });
                }
            }

            // 2. Text Styles
            if (n.type === 'TEXT' && !n.textStyleId && n.fontSize) {
                const closest = findClosestTextStyle(n.fontSize, n.fontWeight, n.fontFamily, textStyles);
                if (closest) textStyleItems.push({ nodeId: n.id, styleId: closest.id });
            }

            // 3. Colors
            if (n.fills && n.fills.length > 0) {
                n.fills.forEach((fill, index) => {
                    if (fill.type === 'SOLID' && fill.color && !fill.colorVariableId) {
                        const closest = findClosestColor(fill.color.r, fill.color.g, fill.color.b, colorVars);
                        if (closest) colorItems.push({ nodeId: n.id, variableId: closest.id, fillIndex: index });
                    }
                });
            }

            // 4. Spacing & Radius bindings (Skip Illustrations)
            const isIllustration = n.name && (n.name.toLowerCase().includes('illustration') || n.name.toLowerCase().includes('vector'));
            if (!isIllustration) {
                spacingFields.forEach(field => {
                    if (n[field] !== undefined && n[field] !== null) {
                        if (n.boundVariables && n.boundVariables[field]) return;
                        const closest = findClosestFloat(n[field], 'spacing', floatVars);
                        if (closest) bindingItems.push({ nodeId: n.id, field, variableId: closest.id });
                    }
                });

                radiusFields.forEach(field => {
                    if (n[field] !== undefined && n[field] !== null) {
                        if (n.boundVariables && n.boundVariables[field]) return;
                        const closest = findClosestFloat(n[field], 'radius', floatVars);
                        if (closest) bindingItems.push({ nodeId: n.id, field, variableId: closest.id });
                    }
                });
            }

            // 5. Clip Content
            if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'SECTION'].includes(n.type)) {
                propertyItems.push({ nodeId: n.id, field: 'clipsContent', value: true });
            }
        });

        // --- Apply Updates ---
        console.log(`\nPrepared updates for ${nodeId}:`);
        console.log(`- ${renameItems.length} renames`);
        console.log(`- ${textStyleItems.length} text styles`);
        console.log(`- ${colorItems.length} color binds`);
        console.log(`- ${bindingItems.length} layout bindings (spacing/radius)`);
        console.log(`- ${propertyItems.length} properties (clip content)`);
        console.log('\nApplying updates...');

        if (renameItems.length > 0) await sendCommand('bulk_rename', { renames: renameItems });
        if (textStyleItems.length > 0) await sendCommand('bulk_apply_text_style', { items: textStyleItems });
        if (colorItems.length > 0) await sendCommand('bulk_apply_fill_variable', { items: colorItems });
        
        const CHUNK_SIZE = 500;
        if (bindingItems.length > 0) {
            for (let i = 0; i < bindingItems.length; i += CHUNK_SIZE) {
                await sendCommand('bulk_set_variable_binding', { items: bindingItems.slice(i, i + CHUNK_SIZE) });
            }
        }
        if (propertyItems.length > 0) {
            for (let i = 0; i < propertyItems.length; i += CHUNK_SIZE) {
                await sendCommand('bulk_set_property', { items: propertyItems.slice(i, i + CHUNK_SIZE) });
            }
        }

        console.log('Successfully applied all standardization rules!');

    } catch (err) {
        console.error('Error processing standardization:', err.message);
    }
}

async function standardizePage(prefetched = null) {
    const data = prefetched || await fetchDocumentData();
    const frames = await sendCommand('get_page_frames', {});

    const targets = frames.filter(n => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(n.type));
    console.log(`  Found ${targets.length} top-level frames.`);

    for (let i = 0; i < targets.length; i++) {
        const { id, name } = targets[i];
        console.log(`  [${i + 1}/${targets.length}] ${name} (${id})`);
        await processStandardization(id, data);
    }
}

async function standardizeFile() {
    const data = await fetchDocumentData();
    const pages = await sendCommand('get_pages', {});

    console.log(`\nFound ${pages.length} pages in file.\n`);

    for (let i = 0; i < pages.length; i++) {
        const { id, name } = pages[i];
        console.log(`\n=== Page ${i + 1}/${pages.length}: ${name} ===`);
        try {
            await sendCommand('set_current_page', { pageId: id });
        } catch (err) {
            console.error(`  Skipping — could not switch to page: ${err.message}`);
            continue;
        }
        try {
            await standardizePage(data);
        } catch (err) {
            console.error(`  Page failed: ${err.message}`);
        }
    }

    console.log('\nEntire file processed.');
}

// --- CLI Entry Point ---
const cmd = process.argv[2];
const targetId = process.argv[3];

if (!cmd) {
    console.log(`
Usage: node process.js <command> [nodeId]

Commands:
  standardize <nodeId>   - Run the full standardization suite on a frame
  standardize-page       - Run the full standardization suite on every frame on the current page
  standardize-file       - Run the full standardization suite on every page and frame in the file
  clean                  - Delete temporary JSON and JS files from previous manual runs
    `);
    process.exit(0);
}

if (cmd === 'standardize') {
    if (!targetId) {
        console.error('Error: Please provide a nodeId (e.g. 488:373)');
        process.exit(1);
    }
    (async () => {
        await processStandardization(targetId);
    })().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
} else if (cmd === 'standardize-page') {
    (async () => {
        await standardizePage();
    })().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
} else if (cmd === 'standardize-file') {
    (async () => {
        await standardizeFile();
    })().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
} else if (cmd === 'clean') {
    const filesToClean = [
        'apply_clip_content.js', 'apply_components.js', 'apply_second_page.js', 'apply_updates.js',
        'prepare_clip_content.js', 'process_all.js', 'process_components.js', 'process_second_page.js', 'process_text_styles.js',
        'clip_content_payload.json', 'components_nodes.json', 'components_tree.json', 'frame_nodes.json', 'nodes.json',
        'padding_updates.json', 'second_page_nodes.json', 'second_page_tree.json', 'styles.json', 'text_style_updates.json',
        'text_styles.json', 'update_components_payload.json', 'update_payload.json', 'update_second_page_payload.json', 'variables.json'
    ];
    let cleaned = 0;
    for (const f of filesToClean) {
        if (fs.existsSync(f)) {
            fs.unlinkSync(f);
            cleaned++;
        }
    }
    console.log(`Cleaned up ${cleaned} temporary files.`);
} else {
    console.error(`Unknown command: ${cmd}`);
}

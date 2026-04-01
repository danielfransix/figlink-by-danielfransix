#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');
const { execSync } = require('child_process');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// Configuration
const WS_URL = 'ws://localhost:9001';

// ─── Figma URL parser (mirrors figma.js) ─────────────────────────────────────

function parseFigmaUrl(input) {
  try {
    const u = new URL(input);
    if (!u.hostname.includes('figma.com')) return { fileKey: null, nodeId: null };
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'design' || p === 'file' || p === 'proto');
    const fileKey = idx !== -1 ? parts[idx + 1] : null;
    let nodeId = u.searchParams.get('node-id');
    if (nodeId) {
      nodeId = decodeURIComponent(nodeId);
      if (!nodeId.includes(':')) nodeId = nodeId.replace('-', ':');
    }
    return { fileKey, nodeId: nodeId || null };
  } catch {
    return { fileKey: null, nodeId: null };
  }
}

// ─── --file flag parsing ──────────────────────────────────────────────────────

let targetFileKey = null;
const _fileIdx = process.argv.indexOf('--file');
if (_fileIdx !== -1) {
  const val = process.argv[_fileIdx + 1];
  if (val) {
    const parsed = parseFigmaUrl(val);
    targetFileKey = parsed.fileKey || val;
    process.argv.splice(_fileIdx, 2);
  }
}

// ─── WebSocket helper ─────────────────────────────────────────────────────────

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
            const msg = { id, command, params };
            if (targetFileKey) msg.fileKey = targetFileKey;
            ws.send(JSON.stringify(msg));
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

module.exports = { sendCommand };

// ─── Data fetching ────────────────────────────────────────────────────────────

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

// ─── Matching helpers ─────────────────────────────────────────────────────────

function findClosestColor(r, g, b, colorVars) {
    let closest = null;
    let minDiff = Infinity;
    for (const v of colorVars) {
        const c = Object.values(v.valuesByMode)[0];
        if (!c) continue;
        const diff = Math.abs(Math.round(c.r * 255) - r)
                   + Math.abs(Math.round(c.g * 255) - g)
                   + Math.abs(Math.round(c.b * 255) - b);
        if (diff < minDiff) { minDiff = diff; closest = v; }
    }
    return closest;
}

function findClosestFloat(val, type, floatVars) {
    if (val === null || val === undefined) return null;
    const candidates = floatVars.filter(v => v.name.startsWith(`${type}/`));
    let closest = null;
    let minDiff = Infinity;
    for (const c of candidates) {
        const diff = Math.abs(c.val - val);
        if (diff < minDiff) { minDiff = diff; closest = c; }
    }
    if (val === 0 && closest && closest.val !== 0) return null;
    return closest;
}

function findClosestTextStyle(fontSize, fontWeight, fontFamily, textStyles) {
    let closest = null;
    let minDiff = Infinity;
    const weightMap = {
        'Regular': 400, 'Book': 400, 'Normal': 400,
        'Medium': 500, 'SemiBold': 600, 'Semibold': 600,
        'Bold': 700, 'ExtraBold': 800, 'Black': 900
    };
    const targetWeight = weightMap[fontWeight] || 400;
    for (const style of textStyles) {
        if (!style.fontSize) continue;
        if (style.fontSize === fontSize && style.fontWeight === fontWeight) return style;
        const styleWeight = weightMap[style.fontWeight] || 400;
        const totalDiff = Math.abs(style.fontSize - fontSize) * 10
                        + Math.abs(styleWeight - targetWeight) / 100;
        if (totalDiff < minDiff) { minDiff = totalDiff; closest = style; }
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

// ─── Standardization ──────────────────────────────────────────────────────────

async function processStandardization(nodeId, prefetched = null) {
    try {
        const { variables, styles } = prefetched || await fetchDocumentData();
        const nodes = await fetchNodes(nodeId);

        const colorVars  = variables.filter(v => v.resolvedType === 'COLOR');
        const floatVars  = variables.filter(v => v.resolvedType === 'FLOAT').map(v => ({ ...v, val: Object.values(v.valuesByMode)[0] }));
        const textStyles = styles.textStyles || [];

        const renameItems    = [];
        const colorItems     = [];
        const bindingItems   = [];
        const textStyleItems = [];
        const propertyItems  = [];

        const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'];
        const radiusFields  = ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];

        nodes.forEach(n => {
            // Renaming
            if (n.type === 'TEXT' && n.text) {
                const newName = n.text.trim().substring(0, 30);
                if (newName && n.name !== newName) renameItems.push({ nodeId: n.id, name: newName });
            } else if (n.type === 'FRAME') {
                const t = getFirstText(n.id, nodes);
                if (t) {
                    const newName = t.trim().substring(0, 30);
                    if (newName && n.name !== newName && n.name.startsWith('Frame')) renameItems.push({ nodeId: n.id, name: newName });
                }
            }

            // Text styles
            if (n.type === 'TEXT' && !n.textStyleId && n.fontSize) {
                const closest = findClosestTextStyle(n.fontSize, n.fontWeight, n.fontFamily, textStyles);
                if (closest) textStyleItems.push({ nodeId: n.id, styleId: closest.id });
            }

            // Colors
            if (n.fills && n.fills.length > 0) {
                n.fills.forEach((fill, index) => {
                    if (fill.type === 'SOLID' && fill.color && !fill.colorVariableId) {
                        const closest = findClosestColor(fill.color.r, fill.color.g, fill.color.b, colorVars);
                        if (closest) colorItems.push({ nodeId: n.id, variableId: closest.id, fillIndex: index });
                    }
                });
            }

            // Spacing & radius (skip illustrations)
            const isIllustration = n.name && (n.name.toLowerCase().includes('illustration') || n.name.toLowerCase().includes('vector'));
            if (!isIllustration) {
                spacingFields.forEach(field => {
                    if (n[field] != null && !(n.boundVariables && n.boundVariables[field])) {
                        const closest = findClosestFloat(n[field], 'spacing', floatVars);
                        if (closest) bindingItems.push({ nodeId: n.id, field, variableId: closest.id });
                    }
                });
                radiusFields.forEach(field => {
                    if (n[field] != null && !(n.boundVariables && n.boundVariables[field])) {
                        const closest = findClosestFloat(n[field], 'radius', floatVars);
                        if (closest) bindingItems.push({ nodeId: n.id, field, variableId: closest.id });
                    }
                });
            }

            // Clip content
            if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'SECTION'].includes(n.type)) {
                propertyItems.push({ nodeId: n.id, field: 'clipsContent', value: true });
            }
        });

        console.log(`\nPrepared updates for ${nodeId}:`);
        console.log(`  ${renameItems.length} renames`);
        console.log(`  ${textStyleItems.length} text styles`);
        console.log(`  ${colorItems.length} color binds`);
        console.log(`  ${bindingItems.length} layout bindings`);
        console.log(`  ${propertyItems.length} clip content\n`);

        if (renameItems.length)    await sendCommand('bulk_rename', { renames: renameItems });
        if (textStyleItems.length) await sendCommand('bulk_apply_text_style', { items: textStyleItems });
        if (colorItems.length)     await sendCommand('bulk_apply_fill_variable', { items: colorItems });

        const CHUNK = 500;
        for (let i = 0; i < bindingItems.length; i += CHUNK)
            await sendCommand('bulk_set_variable_binding', { items: bindingItems.slice(i, i + CHUNK) });
        for (let i = 0; i < propertyItems.length; i += CHUNK)
            await sendCommand('bulk_set_property', { items: propertyItems.slice(i, i + CHUNK) });

        console.log('Done.');
    } catch (err) {
        console.error('Error:', err.message);
    }
}

async function standardizePage(prefetched = null) {
    const data   = prefetched || await fetchDocumentData();
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
    const data  = await fetchDocumentData();
    const pages = await sendCommand('get_pages', {});
    console.log(`\nFound ${pages.length} pages.\n`);
    for (let i = 0; i < pages.length; i++) {
        const { id, name } = pages[i];
        console.log(`\n=== Page ${i + 1}/${pages.length}: ${name} ===`);
        try { await sendCommand('set_current_page', { pageId: id }); }
        catch (err) { console.error(`  Skipping: ${err.message}`); continue; }
        try { await standardizePage(data); }
        catch (err) { console.error(`  Page failed: ${err.message}`); }
    }
    console.log('\nEntire file processed.');
}

// ─── Active prompt printer ────────────────────────────────────────────────────

async function printActivePrompt() {
  try {
    const result = await sendCommand('get_active_prompt', {}, 5000);
    if (result && result.content) {
      process.stdout.write(`\n--- Active Prompt: ${result.id} ---\n${result.content}\n--- End Prompt ---\n\n`);
    }
  } catch (_) {
    // Non-fatal: prompt unavailable, continue without it
    process.stderr.write('[Figlink] Warning: Could not load active prompt. Start server via node start.js.\n\n');
  }
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

const cmd      = process.argv[2];
const targetId = process.argv[3];

if (!cmd) {
    console.log(`
Usage: node tools/process.js [--file <fileKey|figmaUrl>] <command> [nodeId]

Commands:
  standardize <nodeId>   Run the full standardization suite on a frame
  standardize-page       Run standardization on every frame on the current page
  standardize-file       Run standardization on every page and frame in the file
  clean                  Delete all files from the temp/ folder
`);
    process.exit(0);
}

if (cmd === 'standardize') {
    if (!targetId) { console.error('Error: provide a nodeId'); process.exit(1); }
    printActivePrompt().then(() => processStandardization(targetId)).catch(err => { console.error(err.message); process.exit(1); });
} else if (cmd === 'standardize-page') {
    printActivePrompt().then(() => standardizePage()).catch(err => { console.error(err.message); process.exit(1); });
} else if (cmd === 'standardize-file') {
    printActivePrompt().then(() => standardizeFile()).catch(err => { console.error(err.message); process.exit(1); });
} else if (cmd === 'clean') {
    if (!fs.existsSync(TEMP_DIR)) {
        console.log('Temp folder is empty — nothing to clean.');
    } else {
        let cleaned = 0;
        for (const f of fs.readdirSync(TEMP_DIR)) {
            if (f === '.gitignore') continue;
            fs.unlinkSync(path.join(TEMP_DIR, f));
            cleaned++;
        }
        console.log(`Cleaned ${cleaned} files from temp/.`);
    }
} else {
    console.error(`Unknown command: ${cmd}`);
}

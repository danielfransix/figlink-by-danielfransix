#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// ─── Configuration constants ──────────────────────────────────────────────────
const WS_URL                 = 'ws://localhost:9001';
const BULK_BINDING_CHUNK     = 500;   // Max items per bulk_set_variable_binding call
const STANDARDIZE_TIMEOUT_MS = 300000; // 5 min per frame
const PAGE_CONCURRENCY       = 3;     // Max pages processed in parallel
// Match quality thresholds — skip binding if the closest match is too far off
const COLOR_MAX_DIST         = 30;    // Max RGB Manhattan distance (0–765) to bind a color
const FLOAT_MAX_DIFF         = 4;     // Max pixel difference to bind a spacing/radius value (generous enough for cadence snapping)

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

async function sendCommand(command, params, timeoutMs = 180000, overrideFileKey = null) {
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
            const fileKey = overrideFileKey || targetFileKey;
            if (fileKey) msg.fileKey = fileKey;
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
    console.log('Fetching document variables and styles...');
    const [localVarsResult, styles] = await Promise.all([
        sendCommand('get_local_variables', {}, STANDARDIZE_TIMEOUT_MS),
        sendCommand('get_local_styles', {}, STANDARDIZE_TIMEOUT_MS),
    ]);

    // Local vars from the current file (includes already-imported library vars).
    const localVars = (localVarsResult.variables || localVarsResult).map(v => ({ ...v, _source: 'local' }));

    // Merge in pre-fetched library variables if available.
    // To use this, save your library variable export to temp/library-variables.json.
    let variables = localVars;
    const prebuiltPath = path.join(TEMP_DIR, 'library-variables.json');
    if (fs.existsSync(prebuiltPath)) {
        console.log('Loading pre-fetched library variables from temp/library-variables.json...');
        const prebuilt = JSON.parse(fs.readFileSync(prebuiltPath, 'utf8'));
        const libVars = (prebuilt.variables || []).map(v => ({ ...v, _source: 'library' }));
        // Deduplicate: local wins if same name exists
        const localNames = new Set(localVars.map(v => v.name));
        const newLibVars = libVars.filter(v => !localNames.has(v.name));
        variables = [...localVars, ...newLibVars];
        console.log(`  Local: ${localVars.length}, Library additions: ${newLibVars.length}, Total: ${variables.length} variables`);
    }

    return { variables, styles };
}

async function fetchNodes(nodeId) {
    console.log(`Fetching nodes for frame ${nodeId}...`);
    return await sendCommand('get_nodes_flat', { nodeId, skipVectors: true, skipInstanceChildren: true });
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
    return minDiff <= COLOR_MAX_DIST ? closest : null;
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
    return minDiff <= FLOAT_MAX_DIFF ? closest : null;
}

// Find the closest matching text style by font size and weight.
// Exact match wins; otherwise scores by weighted distance (size matters more than weight).
function findClosestTextStyle(fontSize, fontWeight, textStyles) {
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
        const floatVars  = variables.filter(v => v.resolvedType === 'FLOAT').reduce((acc, v) => {
            const val = Object.values(v.valuesByMode)[0];
            if (val !== undefined) acc.push({ ...v, val });
            return acc;
        }, []);
        const textStyles = styles.textStyles || [];

        const renameItems    = [];
        const colorItems     = [];
        const bindingItems   = [];
        const textStyleItems = [];

        const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'];
        const radiusFields  = ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];

        nodes.forEach(n => {
            // Never modify component instances
            if (n.type === 'INSTANCE') return;

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

            // Text styles — bind any text node that has no style applied yet
            if (n.type === 'TEXT' && n.fontSize && !n.textStyleId) {
                const closest = findClosestTextStyle(n.fontSize, n.fontWeight, textStyles);
                if (closest) textStyleItems.push({ nodeId: n.id, styleId: closest.id });
            }

            // Colors — track whether variable is local (apply by id) or library (apply by key)
            if (n.fills && n.fills.length > 0) {
                n.fills.forEach((fill, index) => {
                    if (fill.type === 'SOLID' && fill.color && !fill.colorVariableId) {
                        const closest = findClosestColor(fill.color.r, fill.color.g, fill.color.b, colorVars);
                        if (closest) {
                            if (closest._source === 'library' && closest.key) {
                                colorItems.push({ nodeId: n.id, variableKey: closest.key, fillIndex: index, _byKey: true });
                            } else {
                                colorItems.push({ nodeId: n.id, variableId: closest.id, fillIndex: index });
                            }
                        }
                    }
                });
            }

            // Spacing & radius (skip illustrations)
            const isIllustration = n.name && (n.name.toLowerCase().includes('illustration') || n.name.toLowerCase().includes('vector'));
            if (!isIllustration) {
                spacingFields.forEach(field => {
                    if (n[field] != null && !(n.boundVariables && n.boundVariables[field])) {
                        const closest = findClosestFloat(n[field], 'spacing', floatVars);
                        if (closest) {
                            if (closest._source === 'library' && closest.key) {
                                bindingItems.push({ nodeId: n.id, field, variableKey: closest.key, _byKey: true });
                            } else {
                                bindingItems.push({ nodeId: n.id, field, variableId: closest.id });
                            }
                        }
                    }
                });
                radiusFields.forEach(field => {
                    if (n[field] != null && !(n.boundVariables && n.boundVariables[field])) {
                        const closest = findClosestFloat(n[field], 'radius', floatVars);
                        if (closest) {
                            if (closest._source === 'library' && closest.key) {
                                bindingItems.push({ nodeId: n.id, field, variableKey: closest.key, _byKey: true });
                            } else {
                                bindingItems.push({ nodeId: n.id, field, variableId: closest.id });
                            }
                        }
                    }
                });
            }
        });

        const colorLocal  = colorItems.filter(x => !x._byKey);
        const colorByKey  = colorItems.filter(x =>  x._byKey);
        const bindLocal   = bindingItems.filter(x => !x._byKey);
        const bindByKey   = bindingItems.filter(x =>  x._byKey);

        console.log(`\nPrepared updates for ${nodeId}:`);
        console.log(`  ${renameItems.length} renames`);
        console.log(`  ${textStyleItems.length} text styles`);
        console.log(`  ${colorLocal.length} color binds (local) + ${colorByKey.length} (library)`);
        console.log(`  ${bindLocal.length} layout bindings (local) + ${bindByKey.length} (library)\n`);

        // Pre-import all unique library variable keys in one parallelized shot,
        // then swap variableKey → variableId so we can use the fast local-ID commands.
        const allLibraryKeys = [...new Set([
            ...colorByKey.map(x => x.variableKey),
            ...bindByKey.map(x => x.variableKey),
        ])];
        let keyToId = {};
        if (allLibraryKeys.length > 0) {
            console.log(`  Pre-importing ${allLibraryKeys.length} unique library variable keys...`);
            keyToId = await sendCommand('import_variables_by_key', { keys: allLibraryKeys }, STANDARDIZE_TIMEOUT_MS);
            const resolved = Object.values(keyToId).filter(Boolean).length;
            console.log(`  Resolved ${resolved}/${allLibraryKeys.length} keys to local IDs.\n`);
        }

        const colorResolved = colorByKey
            .filter(x => keyToId[x.variableKey])
            .map(x => ({ nodeId: x.nodeId, variableId: keyToId[x.variableKey], fillIndex: x.fillIndex }));
        const bindResolved  = bindByKey
            .filter(x => keyToId[x.variableKey])
            .map(x => ({ nodeId: x.nodeId, field: x.field, variableId: keyToId[x.variableKey] }));

        if (renameItems.length)    await sendCommand('bulk_rename', { renames: renameItems });
        if (textStyleItems.length) await sendCommand('bulk_apply_text_style', { items: textStyleItems });
        if (colorLocal.length)     await sendCommand('bulk_apply_fill_variable', { items: colorLocal });
        if (colorResolved.length)  await sendCommand('bulk_apply_fill_variable', { items: colorResolved });

        const allBindings = [...bindLocal, ...bindResolved];
        for (let i = 0; i < allBindings.length; i += BULK_BINDING_CHUNK)
            await sendCommand('bulk_set_variable_binding', { items: allBindings.slice(i, i + BULK_BINDING_CHUNK) });

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

    for (let i = 0; i < targets.length; i += PAGE_CONCURRENCY) {
        const batch = targets.slice(i, i + PAGE_CONCURRENCY);
        await Promise.all(batch.map(({ id, name }, j) => {
            console.log(`  [${i + j + 1}/${targets.length}] ${name} (${id})`);
            return processStandardization(id, data).catch(e => {
                console.error(`  ✗ ${name}: ${e.message}`);
            });
        }));
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

async function setLineHeightAuto() {
    try {
        console.log('Fetching local styles...');
        const styles = await sendCommand('get_local_styles', {});
        
        if (!styles.textStyles || styles.textStyles.length === 0) {
            console.log('No text styles found.');
            return;
        }

        const textStyles = styles.textStyles;
        console.log(`Found ${textStyles.length} text styles.`);

        const items = textStyles.map(style => {
            return {
                styleId: style.id,
                field: 'lineHeight',
                value: { unit: 'AUTO' }
            };
        });

        console.log(`Setting line height to auto for ${items.length} styles in chunks...`);
        const results = [];
        const chunkSize = 10;
        
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            console.log(`Processing chunk ${i / chunkSize + 1} of ${Math.ceil(items.length / chunkSize)}...`);
            const chunkResults = await sendCommand('bulk_set_style_property', { items: chunk });
            results.push(...chunkResults);
        }
        
        const successCount = results.filter(r => r.ok).length;
        console.log(`Successfully updated ${successCount}/${items.length} styles.`);
        
        const failures = results.filter(r => !r.ok);
        if (failures.length > 0) {
            console.log('Failures:');
            failures.forEach(f => console.log(`Style ${f.styleId} failed: ${f.error}`));
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

function toTitleCase(str) {
    return str.replace(/\w\S*/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
    });
}

async function titleCaseText(nodeId) {
    try {
        console.log(`Fetching text nodes in ${nodeId}...`);
        const nodes = await fetchNodes(nodeId);
        const textNodes = nodes.filter(n => n.type === 'TEXT');

        if (textNodes.length === 0) {
            console.log('No text nodes found.');
            return;
        }

        const textUpdates = [];

        textNodes.forEach(n => {
            if (n.text) {
                const titleCased = toTitleCase(n.text);
                if (titleCased !== n.text) {
                    textUpdates.push({ nodeId: n.id, text: titleCased });
                }
            }
        });

        console.log(`Found ${textNodes.length} text nodes. Applying title case to ${textUpdates.length} nodes.`);

        if (textUpdates.length > 0) {
            await sendCommand('bulk_set_characters', { items: textUpdates }, 300000);
        }
        console.log('Done.');
    } catch (err) {
        console.error('Error:', err.message);
    }
}

async function bindFillsToVariables(nodeId) {
    try {
        console.log(`Fetching variables and nodes for ${nodeId}...`);
        const data = await fetchDocumentData();
        const nodes = await fetchNodes(nodeId);
        
        const colorVars = data.variables.filter(v => v.resolvedType === 'COLOR');
        if (colorVars.length === 0) {
            console.log('No color variables found in the document.');
            return;
        }

        const colorItems = [];

        nodes.forEach(n => {
            if (n.fills && n.fills.length > 0) {
                n.fills.forEach((fill, index) => {
                    if (fill.type === 'SOLID' && fill.color && !fill.colorVariableId) {
                        const closest = findClosestColor(fill.color.r, fill.color.g, fill.color.b, colorVars);
                        if (closest) {
                            colorItems.push({ nodeId: n.id, variableId: closest.id, fillIndex: index });
                        }
                    }
                });
            }
        });

        if (colorItems.length === 0) {
            console.log('No un-bound solid fills found to bind.');
            return;
        }

        console.log(`Binding ${colorItems.length} fills to nearest color variables...`);
        for (let i = 0; i < colorItems.length; i += BULK_BINDING_CHUNK) {
            await sendCommand('bulk_apply_fill_variable', { items: colorItems.slice(i, i + BULK_BINDING_CHUNK) }, 300000);
        }
        console.log('Done.');
    } catch (err) {
        console.error('Error:', err.message);
    }
}

async function cacheLibraryVariables(libraryFileKey) {
    if (!libraryFileKey) {
        console.error('Error: provide the fileKey of the connected library file.');
        console.error('  Usage: node tools/process.js cache-library-variables <libraryFileKey>');
        console.error('  Tip:   run node tools/figma.js list_connected_files to see connected fileKeys');
        process.exit(1);
    }
    console.log(`Fetching local variables from library file "${libraryFileKey}"...`);
    // get_local_variables on the library file returns variables WITH key fields,
    // which is required for the standardize pipeline to import them by key.
    // get_all_available_variables does NOT include key fields and cannot be used for binding.
    const result = await sendCommand('get_local_variables', {}, STANDARDIZE_TIMEOUT_MS, libraryFileKey);
    const vars = result.variables || result;
    if (!Array.isArray(vars) || vars.length === 0) {
        console.error('No variables returned. Is the plugin open in that file?');
        process.exit(1);
    }
    const outPath = path.join(TEMP_DIR, 'library-variables.json');
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ variables: vars }, null, 2));
    const colorCount   = vars.filter(v => v.resolvedType === 'COLOR').length;
    const floatCount   = vars.filter(v => v.resolvedType === 'FLOAT').length;
    const stringCount  = vars.filter(v => v.resolvedType === 'STRING').length;
    console.log(`Saved ${vars.length} variables to temp/library-variables.json`);
    console.log(`  COLOR: ${colorCount}  FLOAT: ${floatCount}  STRING: ${stringCount}`);
    console.log(`Run "node tools/process.js standardize <nodeId>" to apply them.`);
}

async function flattenTree(nodeId) {
    console.log(`Analyzing tree for ${nodeId} to find unnecessary nesting...`);
    const response = await sendCommand('get_nodes', { nodeId, depth: 10 });
    
    let root = Array.isArray(response) ? response[0] : response;
    if (!root) {
        console.error('No nodes found or plugin timed out.', response);
        return;
    }

    let flattenedCount = 0;

    // Returns true if the node id looks like an instance override (e.g. "I1234:5678;...")
    const isInstanceNode = id => id.startsWith('I') || id.includes(';');

    async function traverse(node) {
        // Never descend into or modify component instances
        if (node.type === 'INSTANCE' || isInstanceNode(node.id)) return;

        if (node.children && node.children.length > 0) {
            // Snapshot children before traversal — flattening siblings can invalidate later entries
            for (const child of [...node.children]) {
                await traverse(child);
            }
        }

        if (!node.children) return;

        if (['FRAME', 'GROUP'].includes(node.type) && node.id !== nodeId) {
            const isWrapper = node.children.length === 1;
            const hasFills = node.fills && node.fills.length > 0 && node.fills.some(f => f.visible && f.opacity > 0);
            const hasStrokes = node.strokes && node.strokes.length > 0 && node.strokes.some(s => s.visible && s.opacity > 0);
            const hasPadding = (node.paddingTop || 0) > 0 || (node.paddingRight || 0) > 0
                             || (node.paddingBottom || 0) > 0 || (node.paddingLeft || 0) > 0;
            const hasRadius = (node.cornerRadius || 0) > 0
                            || (node.topLeftRadius || 0) > 0 || (node.topRightRadius || 0) > 0
                            || (node.bottomRightRadius || 0) > 0 || (node.bottomLeftRadius || 0) > 0;
            const hasEffects = node.effects && node.effects.some(e => e.visible !== false);
            const hasOpacity = node.opacity !== undefined && node.opacity < 1;

            if (isWrapper && !hasFills && !hasStrokes && !hasPadding && !hasRadius && !hasEffects && !hasOpacity) {
                console.log(`Flattening unnecessary wrapper: ${node.name} (${node.id})`);
                try {
                    await sendCommand('flatten_node', { nodeId: node.id });
                    flattenedCount++;
                } catch (err) {
                    console.error(`Failed to flatten ${node.id}: ${err.message}`);
                }
            }
        }
    }

    await traverse(root);
    console.log(`Flattening complete. Removed ${flattenedCount} unnecessary wrappers.`);
}

// ─── CLI entry (only runs when executed directly, not when require()'d) ────────

if (require.main === module) {
    const cmd      = process.argv[2];
    const targetId = process.argv[3];

    if (!cmd) {
        console.log(`
Usage: node tools/process.js [--file <fileKey|figmaUrl>] <command> [nodeId]

Commands:
  standardize <nodeId>            Run the full standardization suite on a frame
  standardize-page                Run standardization on every frame on the current page
  standardize-file                Run standardization on every page and frame in the file
  cache-library-variables <fileKey> Fetch variables (with keys) from a connected library file and save
                                  to temp/library-variables.json for use by standardize
  clean                           Delete all files from the temp/ folder
  set-line-height-auto            Set the line height of all local text styles to AUTO
  title-case-text <nodeId>        Update text layers in a frame to Title Case
  bind-fills-to-variables <nodeId> Bind all solid fills in a node to the nearest semantic color variables
  flatten <nodeId>                Remove unnecessary wrapper frames/groups that have only 1 child
`);
        process.exit(0);
    }

    if (cmd === 'standardize') {
        if (!targetId) { console.error('Error: provide a nodeId'); process.exit(1); }
        processStandardization(targetId).catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'standardize-page') {
        standardizePage().catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'standardize-file') {
        standardizeFile().catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'set-line-height-auto') {
        setLineHeightAuto().catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'title-case-text') {
        if (!targetId) { console.error('Error: provide a nodeId'); process.exit(1); }
        titleCaseText(targetId).catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'bind-fills-to-variables') {
        if (!targetId) { console.error('Error: provide a nodeId'); process.exit(1); }
        bindFillsToVariables(targetId).catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'flatten') {
        if (!targetId) { console.error('Error: provide a nodeId'); process.exit(1); }
        flattenTree(targetId).catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'cache-library-variables') {
        cacheLibraryVariables(targetId).catch(err => { console.error(err.message); process.exit(1); });
    } else if (cmd === 'clean') {
        if (!fs.existsSync(TEMP_DIR)) {
            console.log('Temp folder is empty — nothing to clean.');
        } else {
            let cleaned = 0;
            for (const f of fs.readdirSync(TEMP_DIR)) {
                if (f === '.gitignore') continue;
                fs.rmSync(path.join(TEMP_DIR, f), { force: true });
                cleaned++;
            }
            console.log(`Cleaned ${cleaned} files from temp/.`);
        }
    } else {
        console.error(`Unknown command: ${cmd}`);
    }
}

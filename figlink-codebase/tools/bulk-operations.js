#!/usr/bin/env node
// tools/bulk-operations.js
// Consolidated generic Figma operations
// Replaces 50+ one-off custom scripts with foundational, reusable actions.

const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');

// ─── WebSocket helper ─────────────────────────────────────────────────────────

function send(command, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:9001');
    const id = randomUUID();
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error(`Timeout on command "${command}"`)); }
    }, timeoutMs);

    ws.on('open', () => ws.send(JSON.stringify({ id, command, params })));

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'active_prompt') return;
      if (msg.id !== id) return;
      done = true; clearTimeout(timer); ws.close();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });

    ws.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

// ─── Core Runner ──────────────────────────────────────────────────────────────

async function runFigmaCode(code, timeoutMs = 120000) {
  return await send('evaluate', { code }, timeoutMs);
}

// ─── Foundational Operations ──────────────────────────────────────────────────

const operations = {
  
  /**
   * Bulk bind a specific property on matching nodes to a variable.
   * Useful for: Binding radius/strokes to variables globally.
   * Usage: node bulk-operations.js bind_variable <property> <variableId> [nodeTypeFilter]
   */
  bind_variable: async (property, variableId, nodeTypeFilter = 'ALL') => {
    console.log(`Binding property '${property}' to variable '${variableId}' (Filter: ${nodeTypeFilter})...`);
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        let count = 0;
        const filter = ${JSON.stringify(nodeTypeFilter)};
        const prop = ${JSON.stringify(property)};
        const varId = ${JSON.stringify(variableId)};
        
        for (const page of figma.root.children) {
          const nodes = page.findAll(n => (filter === 'ALL' || n.type === filter) && prop in n);
          for (const n of nodes) {
            try {
              n.setBoundVariable(prop, varId);
              count++;
            } catch (e) {}
          }
        }
        return { modified: count };
      })()
    `;
    const res = await runFigmaCode(code);
    console.log('Result:', res);
  },

  /**
   * Bulk find and replace text across all pages based on a JSON map.
   * Useful for: Updating copy, fixing lorem ipsum.
   * Usage: node bulk-operations.js replace_text <json_map_path>
   */
  replace_text: async (jsonMapPath) => {
    const fs = require('fs');
    if (!fs.existsSync(jsonMapPath)) throw new Error('File not found: ' + jsonMapPath);
    const map = JSON.parse(fs.readFileSync(jsonMapPath, 'utf8'));
    console.log(`Replacing text for ${Object.keys(map).length} nodes...`);
    
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        const map = ${JSON.stringify(map)};
        let count = 0;
        let notFound = [];
        
        for (const [id, newText] of Object.entries(map)) {
          const n = figma.getNodeById(id);
          if (n && n.type === 'TEXT') {
            await Promise.all(n.getRangeAllFontNames(0, n.characters.length).map(figma.loadFontAsync));
            n.characters = newText;
            count++;
          } else {
            notFound.push(id);
          }
        }
        return { modified: count, notFound: notFound.length };
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log('Result:', res);
  },

  /**
   * Bulk reset instances across all pages.
   * Useful for: Reverting rogue text style overrides or stray sizing.
   * Usage: node bulk-operations.js reset_instances [preserveText:true|false]
   */
  reset_instances: async (preserveTextStr = 'true') => {
    const preserveText = preserveTextStr === 'true';
    console.log(`Resetting instances (Preserve Text: ${preserveText})...`);
    
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        let count = 0;
        const preserve = ${preserveText};
        
        for (const page of figma.root.children) {
          const instances = page.findAll(n => n.type === 'INSTANCE');
          for (const inst of instances) {
            let texts = [];
            if (preserve) {
              const textNodes = inst.findAll(n => n.type === 'TEXT');
              texts = textNodes.map(t => ({ id: t.id, chars: t.characters }));
            }
            try {
              inst.resetOverrides();
              count++;
              if (preserve) {
                // Restore text
                for (const t of texts) {
                  const node = figma.getNodeById(t.id);
                  if (node && node.type === 'TEXT') {
                    await Promise.all(node.getRangeAllFontNames(0, node.characters.length).map(figma.loadFontAsync));
                    node.characters = t.chars;
                  }
                }
              }
            } catch(e) {}
          }
        }
        return { reset: count };
      })()
    `;
    const res = await runFigmaCode(code, 600000);
    console.log('Result:', res);
  },

  /**
   * Scan texts across all pages matching a regex.
   * Useful for: Finding bad texts, lorem ipsum, long texts.
   * Usage: node bulk-operations.js scan_text <regex>
   */
  scan_text: async (regexStr) => {
    console.log(`Scanning texts matching /${regexStr}/i...`);
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        const regex = new RegExp(${JSON.stringify(regexStr)}, 'i');
        const matches = [];
        
        for (const page of figma.root.children) {
          const texts = page.findAll(n => n.type === 'TEXT' && regex.test(n.characters));
          for (const t of texts) {
            matches.push({ id: t.id, text: t.characters, page: page.name });
          }
        }
        return { count: matches.length, matches: matches.slice(0, 100) }; // limit output
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log(`Found ${res.count} matches. Showing up to 100:`);
    console.log(res.matches);
  },

  /**
   * Bulk modify a specific boolean/number property (e.g. clipContent = false)
   * Useful for: Setting clipContent globally or tweaking simple layout fields.
   * Usage: node bulk-operations.js set_property <property> <value> [nodeTypeFilter]
   */
  set_property: async (property, valueStr, nodeTypeFilter = 'ALL') => {
    console.log(`Setting property '${property}' to '${valueStr}' (Filter: ${nodeTypeFilter})...`);
    let value = valueStr;
    if (valueStr === 'true') value = true;
    if (valueStr === 'false') value = false;
    if (!isNaN(Number(valueStr))) value = Number(valueStr);
    
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        let count = 0;
        const filter = ${JSON.stringify(nodeTypeFilter)};
        const prop = ${JSON.stringify(property)};
        const val = ${JSON.stringify(value)};
        
        for (const page of figma.root.children) {
          const nodes = page.findAll(n => (filter === 'ALL' || n.type === filter) && prop in n);
          for (const n of nodes) {
            try {
              n[prop] = val;
              count++;
            } catch (e) {}
          }
        }
        return { modified: count };
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log('Result:', res);
  }
};

// ─── CLI Entry ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || !operations[command]) {
  console.error('Usage: node bulk-operations.js <command> [args]');
  console.error('Available commands:');
  Object.keys(operations).forEach(cmd => console.error(`  - ${cmd}`));
  process.exit(1);
}

// 1. Ping
send('ping', {}, 5000).then(() => {
  operations[command](...args.slice(1)).catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}).catch(() => {
  console.error('Figlink not reachable — is the server running and plugin open?');
  process.exit(1);
});

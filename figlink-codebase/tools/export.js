#!/usr/bin/env node
// Export image-fill nodes from a Figma frame to disk.
//
// Usage:
//   node tools/export.js <frameNodeId> <outputDir> [--format PNG|SVG] [--scale 2]
//   node tools/export.js 93:5077 "C:/path/to/assets"
//   node tools/export.js 93:5077 "C:/path/to/assets" --format SVG

const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length < 2 || args[0] === '--help') {
  console.error('Usage: node tools/export.js <frameNodeId> <outputDir> [--format PNG|SVG] [--scale 2]');
  process.exit(1);
}

const frameNodeId = args[0];
const outputDir   = path.resolve(args[1]);

let format = 'PNG';
let scale  = 2;

for (let i = 2; i < args.length; i++) {
  if (args[i] === '--format' && args[i + 1]) { format = args[++i].toUpperCase(); }
  if (args[i] === '--scale'  && args[i + 1]) { scale  = parseFloat(args[++i]); }
}

const EXT = { PNG: 'png', JPG: 'jpg', SVG: 'svg', PDF: 'pdf' }[format] || 'png';

// ─── WebSocket helper ─────────────────────────────────────────────────────────

function send(command, params, timeoutMs = 60000) {
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
      if (msg.type === 'active_prompt') return; // skip system prompt injection
      if (msg.id !== id) return;
      done = true; clearTimeout(timer); ws.close();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });

    ws.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

// ─── Slug helper ─────────────────────────────────────────────────────────────

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  // 1. Ping
  await send('ping').catch(() => { console.error('Figlink not reachable — is the server running and plugin open?'); process.exit(1); });

  // 2. Find all image nodes in the frame
  console.log(`\nScanning frame ${frameNodeId} for image nodes…`);
  const imageNodes = await send('find_image_nodes', { nodeId: frameNodeId });

  if (!imageNodes.length) {
    console.log('No image-fill nodes found in that frame.');
    process.exit(0);
  }

  console.log(`Found ${imageNodes.length} image node(s):\n`);
  imageNodes.forEach(n => console.log(`  [${n.id}] ${n.name}`));

  // 3. Rename nodes with unique, clean names
  // Instance sub-nodes (IDs starting with "I" and containing ";") can't be meaningfully
  // renamed in Figma (they're overrides inside a component). For those, we still assign
  // a clean file slug but skip the Figma rename.
  const seen = new Set();
  const renamed = [];

  for (const node of imageNodes) {
    const isInstanceSubNode = node.id.startsWith('I') && node.id.includes(';');

    // Build a clean slug base from the current name, stripping Figma-generated noise
    let base = node.name
      .replace(/^Gemini_Generated_Image_\S+/i, 'illustration')
      .replace(/^image$/i, 'illustration') // generic "Image" names
      .replace(/\s+\d+$/, '')
      .trim() || 'illustration';

    let slug = toSlug(base);
    let candidate = slug;
    let counter = 1;
    while (seen.has(candidate)) { candidate = `${slug}-${++counter}`; }
    seen.add(candidate);

    const newName = candidate;

    if (!isInstanceSubNode && newName !== node.name) {
      await send('rename_node', { nodeId: node.id, name: newName });
      console.log(`\nRenamed: "${node.name}" → "${newName}"`);
    } else if (isInstanceSubNode) {
      console.log(`\nInstance node "${node.id}" → slug: "${newName}" (Figma rename skipped)`);
    } else {
      console.log(`\nKept name: "${node.name}"`);
    }

    renamed.push({ id: node.id, oldName: node.name, newName });
  }

  // 4. Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // 5. Export each node
  console.log(`\nExporting ${imageNodes.length} node(s) as ${format} to:\n  ${outputDir}\n`);

  const exported = [];

  for (const { id, newName } of renamed) {
    process.stdout.write(`  Exporting "${newName}"… `);
    try {
      const res = await send('export_node', { nodeId: id, format, scale }, 60000);
      const filePath = path.join(outputDir, `${newName}.${EXT}`);
      fs.writeFileSync(filePath, Buffer.from(res.base64, 'base64'));
      exported.push(filePath);
      console.log(`✓  ${newName}.${EXT}`);
    } catch (err) {
      console.log(`✗  ${err.message}`);
    }
  }

  console.log(`\nDone. ${exported.length}/${imageNodes.length} file(s) saved to ${outputDir}`);
})();

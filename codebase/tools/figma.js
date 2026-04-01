#!/usr/bin/env node
// Usage: node tools/figma.js [--file <fileKey|figmaUrl>] <command> [params-as-json]
// Examples:
//   node tools/figma.js ping
//   node tools/figma.js list_connected_files
//   node tools/figma.js parse_link https://figma.com/design/abc123/Name?node-id=488-513
//   node tools/figma.js --file abc123 get_nodes '{"nodeId":"488:513"}'
//   node tools/figma.js --file https://figma.com/design/abc123/Name get_local_styles

const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');

// ─── Figma URL parser ─────────────────────────────────────────────────────────

function parseFigmaUrl(input) {
  try {
    const u = new URL(input);
    if (!u.hostname.includes('figma.com')) return { fileKey: null, nodeId: null };
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'design' || p === 'file' || p === 'proto');
    const fileKey = idx !== -1 ? parts[idx + 1] : null;
    let nodeId = u.searchParams.get('node-id');
    if (nodeId) {
      // Handle both "123%3A456" (old) and "123-456" (new) formats
      nodeId = decodeURIComponent(nodeId);
      if (!nodeId.includes(':')) nodeId = nodeId.replace('-', ':');
    }
    return { fileKey, nodeId: nodeId || null };
  } catch {
    return { fileKey: null, nodeId: null };
  }
}

// ─── parse_link — local command, no server needed ────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs[0] === 'parse_link') {
  const url = rawArgs[1];
  if (!url) {
    console.error('Usage: node tools/figma.js parse_link <figmaUrl>');
    process.exit(1);
  }
  const parsed = parseFigmaUrl(url);
  if (!parsed.fileKey) {
    console.error(JSON.stringify({ error: 'Could not parse a file key from that URL' }));
    process.exit(1);
  }
  console.log(JSON.stringify(parsed, null, 2));
  process.exit(0);
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

let fileKey = null;
const args = [...rawArgs];

const fileIdx = args.indexOf('--file');
if (fileIdx !== -1) {
  const val = args[fileIdx + 1];
  if (!val) {
    console.error('--file requires a value (fileKey or Figma URL)');
    process.exit(1);
  }
  const parsed = parseFigmaUrl(val);
  fileKey = parsed.fileKey || val;
  args.splice(fileIdx, 2);
}

const command = args[0];
let params = {};
if (args[1]) {
  try {
    params = JSON.parse(args[1]);
  } catch (e) {
    console.error('Invalid JSON for params argument:', e.message);
    process.exit(1);
  }
}

if (!command) {
  console.error(`Usage: node tools/figma.js [--file <fileKey|figmaUrl>] <command> [params-json]

Special commands (no server needed):
  parse_link <url>         Parse a Figma URL into fileKey + nodeId
  list_connected_files     List all files with an active plugin connection`);
  process.exit(1);
}

// ─── WebSocket call ───────────────────────────────────────────────────────────

const ws = new WebSocket('ws://localhost:9001');
const id = randomUUID();
let done = false;

const msg = { id, command, params };
if (fileKey) msg.fileKey = fileKey;

const timeout = setTimeout(() => {
  if (!done) {
    console.error(JSON.stringify({ error: 'Timeout — is the Figlink server running and plugin connected?' }));
    process.exit(1);
  }
}, 15000);

ws.on('open', () => {
  ws.send(JSON.stringify(msg));
});

ws.on('message', (raw) => {
  const res = JSON.parse(raw.toString());

  // Active prompt auto-injected by server — print before command result
  if (res.type === 'active_prompt') {
    if (res.warning) {
      process.stderr.write(`[Figlink] Warning: ${res.warning}\n\n`);
    } else if (res.content) {
      process.stdout.write(`\n--- Active Prompt: ${res.id} ---\n${res.content}\n--- End Prompt ---\n\n`);
    }
    return;
  }

  if (res.id !== id) return;
  done = true;
  clearTimeout(timeout);
  ws.close();
  if (res.error) {
    console.error(JSON.stringify({ error: res.error }));
    process.exit(1);
  }
  console.log(JSON.stringify(res.result, null, 2));
  process.exit(0);
});

ws.on('error', (e) => {
  if (!done) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
});

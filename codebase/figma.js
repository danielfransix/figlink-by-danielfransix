#!/usr/bin/env node
// Usage: node figma.js <command> [params-as-json]
// Example: node figma.js ping
// Example: node figma.js set_characters '{"nodeId":"488:513","text":"Log in to your account"}'

const WebSocket = require('./link-server/node_modules/ws');
const { randomUUID } = require('crypto');

const command = process.argv[2];
let params = {};
if (process.argv[3]) {
  try {
    params = JSON.parse(process.argv[3]);
  } catch (e) {
    console.error('Invalid JSON for params argument:', e.message);
    process.exit(1);
  }
}

if (!command) {
  console.error('Usage: node figma.js <command> [params-json]');
  process.exit(1);
}

const ws = new WebSocket('ws://localhost:9001');
const id = randomUUID();
let done = false;

const timeout = setTimeout(() => {
  if (!done) {
    console.error(JSON.stringify({ error: 'Timeout — is the Figlink server running and plugin connected?' }));
    process.exit(1);
  }
}, 15000);

ws.on('open', () => {
  ws.send(JSON.stringify({ id, command, params }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id !== id) return;
  done = true;
  clearTimeout(timeout);
  ws.close();
  if (msg.error) {
    console.error(JSON.stringify({ error: msg.error }));
    process.exit(1);
  }
  console.log(JSON.stringify(msg.result, null, 2));
  process.exit(0);
});

ws.on('error', (e) => {
  if (!done) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
});

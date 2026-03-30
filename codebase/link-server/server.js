const WebSocket = require('ws');

const PORT = 9001;
const wss = new WebSocket.Server({ port: PORT });

let pluginWs = null;
const pending = new Map(); // id → sender ws

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Plugin registration
    if (msg.type === 'register' && msg.role === 'plugin') {
      pluginWs = ws;
      console.log('[Figlink] Figma plugin registered');
      ws.send(JSON.stringify({ type: 'registered', role: 'plugin' }));
      return;
    }

    // Any non-plugin client sends a command → forward to plugin
    if (ws !== pluginWs) {
      if (msg.id == null) {
        ws.send(JSON.stringify({ error: 'Missing id field' }));
        return;
      }
      if (pluginWs && pluginWs.readyState === WebSocket.OPEN) {
        pending.set(msg.id, ws);
        pluginWs.send(raw.toString());
      } else {
        ws.send(JSON.stringify({ id: msg.id, error: 'Figma plugin not connected. Open the Figlink plugin in Figma first.' }));
      }
      return;
    }

    // Plugin sends a response → route back to original sender
    if (ws === pluginWs) {
      const sender = pending.get(msg.id);
      if (sender && sender.readyState === WebSocket.OPEN) {
        pending.delete(msg.id);
        sender.send(raw.toString());
      }
      return;
    }
  });

  ws.on('close', () => {
    if (ws === pluginWs) {
      pluginWs = null;
      console.log('[Figlink] Figma plugin disconnected');
      // Notify all waiting CLI clients so they don't hang until timeout
      pending.forEach((sender, id) => {
        if (sender.readyState === WebSocket.OPEN) {
          sender.send(JSON.stringify({ id, error: 'Figma plugin disconnected' }));
        }
      });
      pending.clear();
    }
  });

  ws.on('error', (err) => console.error('[Figlink] WebSocket error:', err.message));
});

wss.on('listening', () => {
  console.log(`[Figlink] Listening on ws://localhost:${PORT}`);
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Figlink] Port ${PORT} already in use.`);
    process.exit(1);
  }
});

// IPC from start.js watcher — broadcast notifications to the connected plugin
process.on('message', (msg) => {
  if (msg && msg.type === 'code_changed') {
    if (pluginWs && pluginWs.readyState === WebSocket.OPEN) {
      pluginWs.send(JSON.stringify({ type: 'code_changed' }));
      console.log('[Figlink] Plugin code-change notification sent.');
    }
  }
});

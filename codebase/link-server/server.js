const WebSocket = require('ws');
const fs = require('fs');

const PORT = 9001;
const wss = new WebSocket.Server({ port: PORT });

const plugins = new Map(); // fileKey → { ws, name }
const pending = new Map(); // id → { sender: ws, fileKey }

let activePrompt = null; // { id, content, path } — set via IPC from start.js

wss.on('connection', (ws) => {
  ws._promptSent = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // ── Plugin registration ───────────────────────────────────────────────────
    if (msg.type === 'register' && msg.role === 'plugin') {
      const fileKey  = msg.fileKey  || `unnamed-${Date.now()}`;
      const fileName = msg.fileName || 'Unknown File';
      plugins.set(fileKey, { ws, name: fileName });
      ws._fileKey = fileKey;
      console.log(`[Figlink] Plugin registered: ${fileName} (${fileKey})`);
      ws.send(JSON.stringify({ type: 'registered', role: 'plugin', fileKey, fileName }));
      return;
    }

    // ── Plugin sending a result back → route to original client ──────────────
    if (ws._fileKey) {
      const entry = pending.get(msg.id);
      if (entry && entry.sender.readyState === WebSocket.OPEN) {
        pending.delete(msg.id);
        entry.sender.send(raw.toString());
      }
      return;
    }

    // ── CLI client: auto-inject active prompt on first command ────────────────
    if (!ws._promptSent) {
      ws._promptSent = true;
      if (activePrompt) {
        ws.send(JSON.stringify({ type: 'active_prompt', id: activePrompt.id, content: activePrompt.content }));
      } else {
        ws.send(JSON.stringify({ type: 'active_prompt', id: null, content: null, warning: 'No prompt loaded — start server via node start.js' }));
      }
    }

    // ── Client sending a command ──────────────────────────────────────────────
    if (msg.id == null) {
      ws.send(JSON.stringify({ error: 'Missing id field' }));
      return;
    }

    // list_connected_files is answered directly by the server
    if (msg.command === 'list_connected_files') {
      const files = [...plugins.entries()].map(([fileKey, { name }]) => ({ fileKey, name }));
      ws.send(JSON.stringify({ id: msg.id, result: files }));
      return;
    }

    // get_active_prompt is answered directly by the server (re-reads from disk)
    if (msg.command === 'get_active_prompt') {
      if (!activePrompt) {
        ws.send(JSON.stringify({ id: msg.id, error: 'No prompt loaded. Start the server via node start.js.' }));
        return;
      }
      let content = activePrompt.content;
      if (activePrompt.path) {
        try { content = fs.readFileSync(activePrompt.path, 'utf8'); } catch (_) {}
      }
      ws.send(JSON.stringify({ id: msg.id, result: { id: activePrompt.id, content } }));
      return;
    }

    // Resolve target plugin
    let targetEntry;
    if (msg.fileKey) {
      targetEntry = plugins.get(msg.fileKey);
      if (!targetEntry) {
        ws.send(JSON.stringify({ id: msg.id, error: `File "${msg.fileKey}" not connected. Use list_connected_files to see what is open.` }));
        return;
      }
    } else if (plugins.size === 1) {
      targetEntry = [...plugins.values()][0];
    } else if (plugins.size === 0) {
      ws.send(JSON.stringify({ id: msg.id, error: 'No Figma plugin connected. Open the Figlink plugin in Figma first.' }));
      return;
    } else {
      const names = [...plugins.values()].map(p => p.name).join(', ');
      ws.send(JSON.stringify({ id: msg.id, error: `Multiple files connected (${names}). Specify --file <fileKey>.` }));
      return;
    }

    if (targetEntry.ws.readyState !== WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: msg.id, error: 'Figma plugin not connected. Open the Figlink plugin in Figma first.' }));
      return;
    }

    // Strip fileKey before forwarding to plugin — it doesn't need it
    const { fileKey: _fk, ...forwardMsg } = msg;
    const resolvedFileKey = msg.fileKey || [...plugins.keys()][0];
    pending.set(msg.id, { sender: ws, fileKey: resolvedFileKey });
    targetEntry.ws.send(JSON.stringify(forwardMsg));
  });

  ws.on('close', () => {
    if (!ws._fileKey) return;
    const entry = plugins.get(ws._fileKey);
    const fileName = entry ? entry.name : ws._fileKey;
    plugins.delete(ws._fileKey);
    console.log(`[Figlink] Plugin disconnected: ${fileName}`);

    // Notify only the pending requests that went to this file
    for (const [id, { sender, fileKey }] of pending) {
      if (fileKey === ws._fileKey && sender.readyState === WebSocket.OPEN) {
        sender.send(JSON.stringify({ id, error: `Figma plugin disconnected: ${fileName}` }));
        pending.delete(id);
      }
    }
  });

  ws.on('error', (err) => console.error('[Figlink] WebSocket error:', err.message));
});

wss.on('listening', () => {
  console.log(`[Figlink] Listening on ws://localhost:${PORT}`);
  // Signal to start.js that the server is ready to receive the active prompt
  if (process.send) process.send({ type: 'ready' });
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Figlink] Port ${PORT} already in use.`);
    process.exit(1);
  }
});

// IPC from start.js
process.on('message', (msg) => {
  if (msg && msg.type === 'set_prompt') {
    activePrompt = { id: msg.id, content: msg.content, path: msg.path };
  }
  if (msg && msg.type === 'code_changed') {
    let notified = 0;
    for (const { ws } of plugins.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'code_changed' }));
        notified++;
      }
    }
    if (notified > 0) console.log(`[Figlink] Code-change notification sent to ${notified} plugin(s).`);
  }
});

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

const PORT = 9001;
const wss = new WebSocket.Server({ port: PORT });

const plugins = new Map(); // fileKey → { ws, name }
const pending = new Map(); // id → { sender: ws, fileKey, createdAt }

// Purge pending entries that have been waiting longer than 120s (e.g. hung plugin)
const PENDING_TTL_MS = 120000;
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (now - entry.createdAt > PENDING_TTL_MS) {
      if (entry.sender.readyState === WebSocket.OPEN) {
        entry.sender.send(JSON.stringify({ id, error: 'Request timed out — plugin did not respond in time.' }));
      }
      pending.delete(id);
    }
  }
}, 10000);

const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system.md');

wss.on('connection', (ws) => {
  ws._promptSent = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      console.warn(`[Figlink] Received unparseable message: ${raw.toString().slice(0, 120)}`);
      return;
    }

    // ── Plugin registration ───────────────────────────────────────────────────
    if (msg.type === 'register' && msg.role === 'plugin') {
      const fileKey  = msg.fileKey  || `unnamed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      if (entry) {
        pending.delete(msg.id); // Always clean up, even if the sender has since closed
        if (entry.sender.readyState === WebSocket.OPEN) {
          entry.sender.send(raw.toString());
        }
      }
      return;
    }

    // ── CLI client: inject system prompt on first command ─────────────────────
    if (!ws._promptSent) {
      ws._promptSent = true;
      try {
        const content = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
        ws.send(JSON.stringify({ type: 'active_prompt', id: 'system', content }));
      } catch (_) {
        // system.md not found — skip injection silently
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
    pending.set(msg.id, { sender: ws, fileKey: resolvedFileKey, createdAt: Date.now() });
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

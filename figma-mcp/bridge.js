const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const FIGLINK_URL = process.env.FIGLINK_URL || 'ws://localhost:9001';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const RECONNECT_DELAY_MS = 5000;

class FiglinkBridge {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.pending = new Map();
    this.connected = false;
    this._connectTimer = null;
  }

  connect() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.connected = true;
      console.log('[figlink-bridge] Connected to Figlink server');
    });

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        console.warn('[figlink-bridge] Unparseable message from Figlink');
        return;
      }

      if (msg.type === 'active_prompt') return;

      const entry = this.pending.get(msg.id);
      if (!entry) return;

      clearTimeout(entry.timeout);
      this.pending.delete(msg.id);

      if (msg.error) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg.result);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      console.log('[figlink-bridge] Disconnected from Figlink server');

      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timeout);
        entry.reject(new Error('Figlink connection closed'));
      }
      this.pending.clear();

      this._connectTimer = setTimeout(() => {
        console.log('[figlink-bridge] Reconnecting...');
        this.connect();
      }, RECONNECT_DELAY_MS);
    });

    this.ws.on('error', (err) => {
      console.error('[figlink-bridge] WebSocket error:', err.message);
    });
  }

  disconnect() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Bridge shutting down'));
    }
    this.pending.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  sendCommand(command, params, fileKey, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Figlink. Run the Figlink plugin in Figma and start the link server.'));
        return;
      }

      const id = randomUUID();
      const msg = { id, command, params: params || {} };
      if (fileKey) msg.fileKey = fileKey;

      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`));
      }, timeoutMs || DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(msg));
    });
  }
}

const bridge = new FiglinkBridge(FIGLINK_URL);

module.exports = { bridge, FiglinkBridge };

'use strict';

// figmarole — Pure Node.js CDP client.
// No npm dependencies. Uses only built-in net, http, crypto modules.

const net    = require('net');
const http   = require('http');
const crypto = require('crypto');

const { DEBUG_PORT } = require('./chrome.js');
const WALKER_SCRIPT  = require('./walker.js');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: DEBUG_PORT, path, timeout: 5000 },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
             return reject(new Error(`CDP HTTP ${res.statusCode}: ${data}`));
          }
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CDP HTTP timeout')); });
  });
}

// ─── Minimal WebSocket client over net.Socket ─────────────────────────────────

class WSClient {
  constructor() {
    this.socket   = null;
    this.buffer   = Buffer.alloc(0);
    this._pending = {};
    this._on      = {};
    this._nextId  = 1;
  }

  connect(host, port, path) {
    return new Promise((resolve, reject) => {
      const key    = crypto.randomBytes(16).toString('base64');
      const socket = net.createConnection(port, host);
      this.socket  = socket;

      let headerBuf = '';
      let upgraded  = false;

      socket.once('connect', () => {
        socket.write([
          `GET ${path} HTTP/1.1`,
          `Host: ${host}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '', '',
        ].join('\r\n'));
      });

      socket.on('data', chunk => {
        if (!upgraded) {
          headerBuf += chunk.toString('binary');
          const end = headerBuf.indexOf('\r\n\r\n');
          if (end === -1) return;

          if (!headerBuf.includes('101')) {
            reject(new Error('WebSocket upgrade failed'));
            socket.destroy();
            return;
          }

          upgraded = true;
          const after = headerBuf.slice(end + 4);
          if (after.length > 0) {
            this.buffer = Buffer.concat([this.buffer, Buffer.from(after, 'binary')]);
            this._parse();
          }
          resolve(this);
          return;
        }

        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._parse();
      });

      socket.on('error', err => { if (!upgraded) reject(err); });
      socket.setTimeout(6000, () => {
        if (!upgraded) { reject(new Error('WebSocket connect timeout')); socket.destroy(); }
      });
    });
  }

  _parse() {
    while (this.buffer.length >= 2) {
      const b0     = this.buffer[0];
      const b1     = this.buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payLen   = b1 & 0x7f;
      let offset   = 2;

      if (payLen === 126) {
        if (this.buffer.length < 4) return;
        payLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payLen === 127) {
        if (this.buffer.length < 10) return;
        const hi = this.buffer.readUInt32BE(2);
        const lo = this.buffer.readUInt32BE(6);
        payLen   = hi * 0x100000000 + lo;
        offset   = 10;
      }

      if (masked) offset += 4;
      if (this.buffer.length < offset + payLen) return;

      let payload = this.buffer.slice(offset, offset + payLen);
      if (masked) {
        const mask = this.buffer.slice(offset - 4, offset);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      this.buffer = this.buffer.slice(offset + payLen);

      if (opcode === 0x1 || opcode === 0x2) {
        this._dispatch(payload.toString('utf8'));
      } else if (opcode === 0x8) {
        this.socket.destroy();
      } else if (opcode === 0x9) {
        this._sendRaw(0xa, payload); // pong
      }
    }
  }

  _dispatch(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.id !== undefined && this._pending[msg.id]) {
      const resolve = this._pending[msg.id];
      delete this._pending[msg.id];
      resolve(msg.result !== undefined ? msg.result : (msg.error || {}));
    } else if (msg.method) {
      (this._on[msg.method] || []).forEach(h => { try { h(msg.params); } catch (_) {} });
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending[id] = resolve;
      try {
        this._sendRaw(0x1, Buffer.from(JSON.stringify({ id, method, params }), 'utf8'));
      } catch (e) {
        delete this._pending[id]; reject(e); return;
      }
      setTimeout(() => {
        if (this._pending[id]) {
          delete this._pending[id];
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 120000);
    });
  }

  on(event, handler) {
    if (!this._on[event]) this._on[event] = [];
    this._on[event].push(handler);
    return this;
  }

  once(event, handler) {
    const wrap = p => { this.off(event, wrap); handler(p); };
    return this.on(event, wrap);
  }

  off(event, handler) {
    if (this._on[event]) this._on[event] = this._on[event].filter(h => h !== handler);
    return this;
  }

  _sendRaw(opcode, data) {
    const len  = data.length;
    const mask = crypto.randomBytes(4);
    let header;

    if (len < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | len;
      mask.copy(header, 2);
    } else if (len < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode; header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2); mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode; header[1] = 0x80 | 127;
      header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
      header.writeUInt32BE(len >>> 0, 6);
      mask.copy(header, 10);
    }

    const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
    this.socket.write(Buffer.concat([header, masked]));
  }

  close() {
    try { this._sendRaw(0x8, Buffer.alloc(0)); } catch (_) {}
    try { this.socket.destroy(); } catch (_) {}
  }
}

// ─── CDP tab helpers ──────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function openTab() {
  // First, get all currently open tabs
  let tabs = [];
  try {
    tabs = await httpGet('/json/list');
  } catch (e) {
    // If we can't even get the list, Chrome might be broken or just starting.
    // Wait a tiny bit and try to force open a new one directly.
    await sleep(500);
  }
  
  if (Array.isArray(tabs)) {
    // Keep exactly ONE tab alive so Chrome doesn't exit entirely when the last tab closes
    const pageTabs = tabs.filter(t => t.type === 'page');
    
    if (pageTabs.length > 0) {
      // Close all but the very first tab
      for (let i = 1; i < pageTabs.length; i++) {
        await closeTab(pageTabs[i].id).catch(() => {});
      }
      
      // Ensure the tab we are returning actually has a valid WebSocket URL
      if (pageTabs[0] && pageTabs[0].webSocketDebuggerUrl) {
         return pageTabs[0];
      }
    }
  }

  // If absolutely no page tabs exist or the remaining tab is broken, ask Chrome to open a new one
  try {
    const newTab = await httpGet('/json/new');
    if (newTab && newTab.webSocketDebuggerUrl) {
      return newTab;
    }
  } catch (e) {
     console.error('Failed to open new tab:', e.message);
  }
  
  throw new Error('Chrome failed to return a valid debugger URL. The headless process might be stuck.');
}

async function closeTab(id) {
  return new Promise(resolve => {
    const req = http.get(
      { hostname: '127.0.0.1', port: DEBUG_PORT, path: `/json/close/${id}`, timeout: 3000 },
      res => { res.resume(); resolve(); }
    );
    req.on('error', resolve);
  });
}

async function connectTab(tab) {
  if (!tab || !tab.webSocketDebuggerUrl) {
    throw new Error('Chrome did not return a debugger URL for the new tab. Is another process using the debug port?');
  }
  const wsUrl = new URL(tab.webSocketDebuggerUrl);
  const ws    = new WSClient();
  await ws.connect(wsUrl.hostname, parseInt(wsUrl.port || 80, 10), wsUrl.pathname + wsUrl.search);
  return ws;
}

// ─── Evaluate helper ──────────────────────────────────────────────────────────

async function evaluate(ws, expression) {
  const r = await ws.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error(`Page JS error: ${r.exceptionDetails.text}`);
  return r.result && r.result.value;
}

// ─── Auto-detect full page height ─────────────────────────────────────────────

async function getFullPageHeight(ws) {
  const h = await evaluate(ws,
    'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'
  );
  return typeof h === 'number' && h > 0 ? h : 900;
}

// ─── Capture one width ────────────────────────────────────────────────────────

async function captureWidth(ws, width) {
  // 1. Reset scroll to top
  await evaluate(ws, 'window.scrollTo(0, 0)');

  // 2. Set viewport to the target width with a large temporary height
  //    so the full page is laid out before we measure it.
  await ws.send('Emulation.setDeviceMetricsOverride', {
    width,
    height:            4000,
    deviceScaleFactor: 1,
    mobile:            width < 768,
  });

  // 3. Short settle for responsive JS / CSS media queries
  await sleep(400);

  // 4. Measure the real full-page height at this width
  const fullHeight = await getFullPageHeight(ws);
  console.log(`  [cdp] width=${width}px  →  full height=${fullHeight}px`);

  // 5. Update viewport to the exact full-page height so all elements
  //    are in the viewport when the walker calls getBoundingClientRect().
  await ws.send('Emulation.setDeviceMetricsOverride', {
    width,
    height:            fullHeight,
    deviceScaleFactor: 1,
    mobile:            width < 768,
  });

  // 6. Another short wait for any layout reflow triggered by height change
  await sleep(200);

  // 7. Run the DOM walker
  const jsonStr = await evaluate(ws, WALKER_SCRIPT);
  if (typeof jsonStr !== 'string') throw new Error('Walker returned no value');

  const result = JSON.parse(jsonStr);
  if (!result.ok) throw new Error(`Walker error: ${result.error}`);

  return {
    width,
    height: fullHeight,
    title:  result.title,
    url:    result.url,
    tree:   result.tree,
  };
}

// ─── Main capture function ────────────────────────────────────────────────────
// widths: number[]  e.g. [1440, 768, 390]
// Returns { ok, title, url, captures: [ { width, height, tree }, ... ] }

const { callKimiAI } = require('./ai.js');

async function capture(targetUrl, widths = [1440]) {
  // Deduplicate and sort largest → smallest
  const sortedWidths = [...new Set(widths.map(Number).filter(w => w >= 320 && w <= 3840))]
    .sort((a, b) => b - a);

  if (sortedWidths.length === 0) throw new Error('No valid widths provided');

  const tab = await openTab();
  if (!tab || !tab.webSocketDebuggerUrl) {
    throw new Error('Could not open a Chrome tab. Ensure no other Chrome instance is running with the same debug port.');
  }

  const ws = await connectTab(tab);

  try {
    await ws.send('Page.enable');
    await ws.send('Network.enable');

    // Navigate once — we resize for each width without reloading
    const loadPromise = new Promise(resolve => {
      ws.once('Page.loadEventFired', resolve);
      setTimeout(resolve, 30000); // hard timeout
    });

    // Set initial viewport to the widest width before navigating,
    // so the page's initial layout is correct.
    await ws.send('Emulation.setDeviceMetricsOverride', {
      width:             sortedWidths[0],
      height:            4000,
      deviceScaleFactor: 1,
      mobile:            sortedWidths[0] < 768,
    });

    await ws.send('Page.navigate', { url: targetUrl });
    await loadPromise;

    // Extra settle time for JS-rendered content (React, Vue, Next.js, etc.)
    await sleep(2000);

    // Capture each width in sequence inside the same tab
    const captures = [];
    for (const width of sortedWidths) {
      console.log(`  [cdp] Capturing width ${width}px…`);
      
      // 1. Run the original walker to get the structural JSON map
      const jsonStr = await evaluate(ws, WALKER_SCRIPT);
      if (typeof jsonStr !== 'string') throw new Error('Walker returned no value');
      const result = JSON.parse(jsonStr);
      if (!result.ok) throw new Error(`Walker error: ${result.error}`);

      // 2. Pass the JSON map to Kimi to generate clean HTML/CSS
      console.log(`  [cdp] Sending structural JSON to Kimi AI...`);
      const aiPrompt = `Here is the structural JSON map of the site. Please output a clean vanilla HTML page containing the CSS inline.\n\nJSON Map:\n${JSON.stringify(result.tree)}`;
      
      const cleanHtml = await callKimiAI(aiPrompt);
      console.log(`  [cdp] Received clean HTML from AI. Injecting back into page...`);
      
      // 3. Inject the clean HTML back into the page
      const injectScript = `(function() {
        document.open();
        document.write(${JSON.stringify(cleanHtml)});
        document.close();
      })()`;
      await evaluate(ws, injectScript);
      
      // 4. Short settle time after injection
      await sleep(1000);

      // 5. Capture the injected AI output width using the normal flow
      const captureResult = await captureWidth(ws, width);
      captures.push(captureResult);
    }

    const title = captures[0] ? captures[0].title : '';
    const url   = captures[0] ? captures[0].url   : targetUrl;

    return { ok: true, title, url, captures };

  } finally {
    ws.close();
    closeTab(tab.id).catch(() => {});
  }
}

module.exports = { capture };

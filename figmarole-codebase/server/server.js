'use strict';

// figmarole — local HTTP server
// Pure Node.js, zero npm dependencies.
// Endpoints:
//   GET  /ping    → health check  (carries ?fileKey=&fileName= from plugin)
//   POST /capture → trigger CDP capture, return DOM tree JSON

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

const { ensureChrome, stopChrome, promptForBrowserAsync, getSavedBrowser, saveBrowser } = require('./chrome.js');
const { capture }      = require('./cdp.js');

const SERVER_PORT  = 7331;
const STATIC_PORT  = 7332;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const PK = '\x1b[38;2;236;72;153m\x1b[1m'; // pink bold  (#EC4899)
const LP = '\x1b[38;2;249;168;212m';        // light pink (#F9A8D4)
const W  = '\x1b[38;2;255;255;255m\x1b[1m'; // white bold
const D  = '\x1b[2m';                       // dim
const G  = '\x1b[38;2;74;222;128m';         // green
const Y  = '\x1b[38;2;251;191;36m';         // yellow
const ER = '\x1b[38;2;248;113;113m';        // red (error)
const R  = '\x1b[0m';                       // reset

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function log(type, msg) {
  const colors = { ok: G, warn: Y, error: ER, connect: PK, disconnect: D, info: LP, dim: D };
  const col = colors[type] || '';
  console.log(`${D}${ts()}${R}  ${col}${msg}${R}`);
}

function printBanner() {
  const lines = [
    '',
    `${PK}  ╔═══════════════════════════════════════════════╗${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ║${R}  ${W}figmarole${R}                                    ${PK}║${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ║${R}  ${LP}Capture any site or local app,${R}               ${PK}║${R}`,
    `${PK}  ║${R}  ${LP}build native editable Figma nodes.${R}           ${PK}║${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ╠═══════════════════════════════════════════════╣${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ║${R}  ${G}Ready${R}  →  ${W}http://localhost:${SERVER_PORT}${R}               ${PK}║${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ║${R}  Open Figma and run the figmarole plugin.     ${PK}║${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ╠═══════════════════════════════════════════════╣${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ║${R}  ${D}Author: Daniel Fransix │ x.com/danielfransix${R} ${PK}║${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ║${R}  ${D}danielfransix.short.gy/buy-coffee${R}            ${PK}║${R}`,
    `${PK}  ║${R}                                               ${PK}║${R}`,
    `${PK}  ╚═══════════════════════════════════════════════╝${R}`,
    '',
  ];
  lines.forEach(function(l) { console.log(l); });
}

// ─── Plugin connection tracking ───────────────────────────────────────────────
// Each Figma file running the plugin pings every 3 s with its fileKey.
// We treat silence for > CONN_TTL ms as a disconnect.

const connectedFiles = new Map(); // fileKey → { fileName, lastSeen }
const CONN_TTL       = 8000;     // ms without a ping → considered disconnected

function touchFile(fileKey, fileName) {
  const now      = Date.now();
  const existing = connectedFiles.get(fileKey);
  if (!existing) {
    connectedFiles.set(fileKey, { fileName, lastSeen: now });
    log('connect', `Plugin connected    "${fileName}"  (${fileKey})`);
  } else {
    existing.lastSeen = now;
    if (fileName && fileName !== existing.fileName) {
      existing.fileName = fileName; // file renamed
    }
  }
}

// Periodic sweep — detect disconnected files
setInterval(() => {
  const now = Date.now();
  for (const [key, info] of connectedFiles) {
    if (now - info.lastSeen > CONN_TTL) {
      connectedFiles.delete(key);
      log('disconnect', `Plugin disconnected  "${info.fileName}"  (${key})`);
    }
  }
}, 2000);

// ─── Capture queue — only one capture at a time ───────────────────────────────
// Chrome CDP has shared state; concurrent captures race on viewport/tab.

let captureActive = false;
const captureQueue = [];

function enqueueCapture(fn) {
  return new Promise((resolve, reject) => {
    captureQueue.push({ fn, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  if (captureActive || captureQueue.length === 0) return;
  captureActive = true;
  const { fn, resolve, reject } = captureQueue.shift();
  fn().then(resolve, reject).finally(() => {
    captureActive = false;
    drainQueue();
  });
}

// ─── MIME types for static file server ───────────────────────────────────────

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.htm':   'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.ts':    'application/javascript; charset=utf-8',
  '.json':  'application/json',
  '.xml':   'application/xml',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.eot':   'application/vnd.ms-fontobject',
  '.mp4':   'video/mp4',
  '.webm':  'video/webm',
  '.txt':   'text/plain',
};

// ─── Internal static file server ─────────────────────────────────────────────

let staticServer  = null;
let staticBaseDir = null;

function startStaticServer(dir) {
  return new Promise((resolve, reject) => {
    if (staticServer && staticBaseDir === dir) {
      resolve(`http://localhost:${STATIC_PORT}`);
      return;
    }

    const teardown = staticServer
      ? new Promise(r => staticServer.close(r))
      : Promise.resolve();

    teardown
      .catch(() => {}) // close() errors are non-fatal — proceed regardless
      .then(() => {
        staticServer = http.createServer((req, res) => {
          // Normalise and clamp the request path inside the base dir
          const rawPath  = new URL(req.url, 'http://localhost').pathname;
          const safe     = path.normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, '');
          let   filePath = path.join(dir, safe);

          if (!filePath.startsWith(path.resolve(dir) + path.sep) &&
              filePath !== path.resolve(dir)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
          }

          if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
          }

          if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }

          const ext  = path.extname(filePath).toLowerCase();
          const mime = MIME[ext] || 'application/octet-stream';

          res.writeHead(200, {
            'Content-Type':                mime,
            'Cache-Control':               'no-store',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath).pipe(res);
        });

        staticServer.listen(STATIC_PORT, 'localhost', () => {
          staticBaseDir = dir;
          log('info', `Static server: ${dir}  →  http://localhost:${STATIC_PORT}`);
          resolve(`http://localhost:${STATIC_PORT}`);
        });

        staticServer.on('error', reject);
      });
  });
}

// ─── Determine capture target URL ─────────────────────────────────────────────

function isHttpUrl(s) {
  return /^https?:\/\//i.test(s.trim());
}

function expandPath(input) {
  let p = input.trim();
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

async function resolveTarget(type, value) {
  if (type === 'url') {
    const trimmed = value.trim();
    if (!isHttpUrl(trimmed)) {
      throw new Error('Invalid URL — must start with http:// or https://');
    }
    return trimmed;
  }

  // type === 'path'
  const localPath = expandPath(value);
  if (!fs.existsSync(localPath)) {
    throw new Error(`Path not found: ${localPath}`);
  }

  const stat = fs.statSync(localPath);
  if (stat.isDirectory()) {
    return startStaticServer(localPath);
  }

  if (stat.isFile()) {
    const ext = path.extname(localPath).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      const base = await startStaticServer(path.dirname(localPath));
      return `${base}/${path.basename(localPath)}`;
    }
    throw new Error(`File must be an HTML file (got ${ext || 'no extension'})`);
  }

  throw new Error(`Path is neither a file nor a directory: ${localPath}`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function countNodes(node) {
  if (!node) return 0;
  return 1 + (node.children || []).reduce((s, c) => s + countNodes(c), 0);
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const MAX_BODY = 1024 * 1024; // 1 MB — guard against runaway payloads

const server = http.createServer((req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const reqUrl   = new URL(req.url, 'http://localhost');
  const pathname = reqUrl.pathname;

  // ── GET /ping ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/ping') {
    const fk = reqUrl.searchParams.get('fileKey')  || '';
    const fn = reqUrl.searchParams.get('fileName') || 'Unknown';
    if (fk) touchFile(fk, fn);
    json(res, 200, { ok: true, tool: 'figmarole', version: '1.0.0', browserPath: getSavedBrowser() || '' });
    return;
  }

  // ── GET /pick-browser ──────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/pick-browser') {
    promptForBrowserAsync().then(picked => {
      if (picked) saveBrowser(picked);
      json(res, 200, { ok: true, path: picked || '' });
    }).catch(err => {
      json(res, 500, { ok: false, error: err.message });
    });
    return;
  }

  // ── POST /capture ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/capture') {
    let rawBody  = '';
    let bodySize = 0;
    let aborted  = false;

    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) {
        aborted = true;
        json(res, 413, { ok: false, error: 'Request body too large (max 1 MB)' });
        req.destroy();
        return;
      }
      rawBody += chunk;
    });

    req.on('end', async () => {
      if (aborted) return;

      let params;
      try {
        params = JSON.parse(rawBody);
      } catch {
        json(res, 400, { ok: false, error: 'Invalid JSON body' });
        return;
      }

      const { type = 'url', value = '', widths = [1440], fileKey = '', fileName = 'Unknown', browserPath = '' } = params;

      // Update file presence on capture requests too
      if (fileKey) touchFile(fileKey, fileName);
      if (browserPath) saveBrowser(browserPath);

      // Reject empty values early
      if (!value.trim()) {
        json(res, 400, { ok: false, error: 'Missing value (URL or path)' });
        return;
      }

      if (!Array.isArray(widths) || widths.length === 0) {
        json(res, 400, { ok: false, error: 'widths must be a non-empty array' });
        return;
      }

      // Queue the capture so only one runs at a time
      const queuePos = captureQueue.length + (captureActive ? 1 : 0);
      if (queuePos > 0) {
        log('info', `Capture queued (position ${queuePos}) for "${fileName}"`);
      }

      try {
        const result = await enqueueCapture(async () => {
          log('info', `Capture started  "${fileName}"  type=${type}  widths=${widths.join(', ')}px`);
          log('dim',  `  target: ${value}`);

          await ensureChrome(browserPath);

          const targetUrl = await resolveTarget(type, value);
          if (targetUrl !== value.trim()) {
            log('dim', `  resolved: ${targetUrl}`);
          }

          const data       = await capture(targetUrl, widths);
          const totalNodes = data.captures.reduce((s, c) => s + countNodes(c.tree), 0);

          log('ok', `Capture done     "${fileName}"  ${data.captures.length} viewport(s), ${totalNodes} nodes`);
          return data;
        });

        json(res, 200, { ok: true, data: result });

      } catch (err) {
        log('error', `Capture failed   "${fileName}"  ${err.message}`);
        json(res, 500, { ok: false, error: err.message });
      }
    });

    req.on('error', err => {
      log('error', `Request error: ${err.message}`);
    });

    return;
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ─── Startup ──────────────────────────────────────────────────────────────────

function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' }); } catch (_) {}
      }
    } else {
      execSync(`lsof -ti tcp:${port} | xargs kill -9`, { shell: true, stdio: 'pipe' });
    }
  } catch (e) {
    // Ignore errors if port is not in use or lsof fails
  }
}

freePort(SERVER_PORT);
freePort(STATIC_PORT);

server.listen(SERVER_PORT, 'localhost', () => {
  printBanner();
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [error] Port ${SERVER_PORT} is already in use.`);
    console.error('  The server may already be running.\n');
  } else {
    console.error('[error] Server error:', err.message);
  }
  process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  log('dim', `Received ${signal} — shutting down…`);
  stopChrome();
  server.close(() => {
    if (staticServer) {
      staticServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
  // Force exit after 3 s if something hangs
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

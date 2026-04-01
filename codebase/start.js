#!/usr/bin/env node
// Figlink — Launcher & Watcher
// Starts the link server and watches source files for changes.

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT             = __dirname;
const SERVER_DIR       = path.join(ROOT, 'link-server');
const SERVER_FILE      = path.join(SERVER_DIR, 'server.js');
const PLUGIN_DIR       = path.join(ROOT, 'figma-plugin');
const PLUGIN_CODE      = path.join(PLUGIN_DIR, 'code.js');
const NODE_MODS        = path.join(SERVER_DIR, 'node_modules');
const PROMPTS_DIR      = path.join(ROOT, 'prompts');
const PROMPT_FILES_DIR = path.join(PROMPTS_DIR, 'prompt-files');
const PROMPT_SETTER    = path.join(PROMPTS_DIR, 'prompt-setter.txt');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const P  = '\x1b[38;2;139;92;246m\x1b[1m'; // purple bold  (#8B5CF6)
const LP = '\x1b[38;2;196;181;253m';        // light purple (#C4B5FD)
const W  = '\x1b[38;2;255;255;255m\x1b[1m'; // white bold
const D  = '\x1b[2m';                       // dim
const Y  = '\x1b[38;2;251;191;36m';         // yellow (#FBBf24)
const G  = '\x1b[38;2;74;222;128m';         // green
const R  = '\x1b[0m';                       // reset

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner() {
  const lines = [
    '',
    `${P}  ╔═══════════════════════════════════════════════╗${R}`,
    `${P}  ║${R}                                               ${P}║${R}`,
    `${P}  ║${R}  ${W}Figlink${R}                                      ${P}║${R}`,
    `${P}  ║${R}                                               ${P}║${R}`,
    `${P}  ║${R}  ${LP}Design <-> Code, linked in real time.${R}        ${P}║${R}`,
    `${P}  ║${R}                                               ${P}║${R}`,
    `${P}  ╠═══════════════════════════════════════════════╣${R}`,
    `${P}  ║${R}                                               ${P}║${R}`,
    `${P}  ║${R}  ${D}Author: Daniel Fransix │ x.com/danielfransix ${R}${P}║${R}`,
    `${P}  ║${R}                                               ${P}║${R}`,
    `${P}  ║${R}  ${D}Buy me a Coffee:                             ${R}${P}║${R}`,
    `${P}  ║${R}  ${D}danielfransix.short.gy/buy-coffee            ${R}${P}║${R}`,
    `${P}  ║${R}                                               ${P}║${R}`,
    `${P}  ╚═══════════════════════════════════════════════╝${R}`,
    '',
  ];
  lines.forEach(l => console.log(l));
}

function log(color, msg) {
  const colors = { purple: P, yellow: Y, green: G, dim: D, white: W };
  console.log(`${colors[color] || ''}${msg}${R}`);
}

// ─── Active prompt ────────────────────────────────────────────────────────────

const E = '\x1b[31m'; // red (errors)

function loadActivePrompt() {
  if (!fs.existsSync(PROMPT_FILES_DIR)) {
    console.error(`\n${E}  ✗  prompts/prompt-files/ folder not found. Create it and add a prompt file.${R}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(PROMPT_SETTER, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(`\n${E}  ✗  prompts/prompt-setter.txt not found. Create it with: prompt_id='your-id'${R}`);
    } else {
      console.error(`\n${E}  ✗  Cannot read prompt-setter.txt: ${e.message}${R}`);
    }
    process.exit(1);
  }

  // Parse prompt_id='...' from first non-empty line
  const line = raw.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  const match = line.match(/^prompt_id\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    console.error(`\n${E}  ✗  Invalid format in prompt-setter.txt. Expected: prompt_id='your-id'${R}`);
    process.exit(1);
  }

  const rawId = match[1].replace(/[^a-zA-Z0-9_-]/g, '');

  if (!rawId) {
    console.error(`\n${E}  ✗  No active prompt set. Edit prompts/prompt-setter.txt and set prompt_id='your-id'.${R}`);
    process.exit(1);
  }

  const promptPath = path.join(PROMPT_FILES_DIR, `${rawId}.md`);

  let stat;
  try {
    stat = fs.statSync(promptPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(`\n${E}  ✗  Active prompt "${rawId}" not found. Create prompts/prompt-files/${rawId}.md to use it.${R}`);
    } else {
      console.error(`\n${E}  ✗  Cannot access prompt file: ${e.message}${R}`);
    }
    process.exit(1);
  }

  if (!stat.isFile()) {
    console.error(`\n${E}  ✗  Prompt "${rawId}" is a directory, not a .md file.${R}`);
    process.exit(1);
  }

  let content;
  try {
    content = fs.readFileSync(promptPath, 'utf8');
  } catch (e) {
    console.error(`\n${E}  ✗  Cannot read prompt file: ${e.message}${R}`);
    process.exit(1);
  }

  if (!content.trim()) {
    console.log(`${Y}  ⚠  Active prompt "${rawId}" is empty — instructions will be blank.${R}`);
  }

  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > 100 * 1024) {
    const kb = Math.round(sizeBytes / 1024);
    console.log(`${Y}  ⚠  Active prompt "${rawId}" is large (${kb}kb) — consider splitting instructions.${R}`);
  }

  return { id: rawId, content, path: promptPath };
}

// ─── Dependency check ─────────────────────────────────────────────────────────

function ensureDeps() {
  if (!fs.existsSync(NODE_MODS)) {
    log('yellow', '  Installing link-server dependencies…');
    try {
      execSync('npm install', { cwd: SERVER_DIR, stdio: 'inherit' });
      log('green', '  Dependencies installed.\n');
    } catch (e) {
      console.error('  Failed to install dependencies. Run: cd link-server && npm install');
      process.exit(1);
    }
  }
}

// ─── Port cleanup ─────────────────────────────────────────────────────────────

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
  } catch (_) {
    // No process was using the port — nothing to do
  }
}

// ─── Server process ───────────────────────────────────────────────────────────

let serverProcess = null;
let restarting = false;
let activePrompt = null;

function startServer() {
  if (serverProcess) {
    serverProcess.removeAllListeners();
    try { serverProcess.kill('SIGTERM'); } catch (_) {}
  }

  freePort(9001);

  serverProcess = spawn('node', [SERVER_FILE], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    cwd: SERVER_DIR,
  });

  // Send active prompt to server once it signals ready
  serverProcess.once('message', (ipcMsg) => {
    if (ipcMsg && ipcMsg.type === 'ready' && activePrompt) {
      try {
        serverProcess.send({ type: 'set_prompt', id: activePrompt.id, content: activePrompt.content, path: activePrompt.path });
      } catch (e) {
        console.error('  [Figlink] Failed to send prompt to server:', e.message);
      }
    }
  });

  serverProcess.on('exit', (code, signal) => {
    // Auto-restart on unexpected crashes (not on our own SIGTERM or during restart)
    if (signal !== 'SIGTERM' && !restarting) {
      setTimeout(() => {
        log('yellow', '\n  [Figlink] Server exited unexpectedly — restarting…');
        startServer();
      }, 1000);
    }
  });
}

function restartServer() {
  restarting = true;
  log('yellow', '\n  [Watch] server.js changed — restarting link server…');
  startServer();
  setTimeout(() => { restarting = false; }, 500);
}

// ─── Code-change notification ─────────────────────────────────────────────────

function notifyCodeChanged() {
  console.log('');
  log('yellow', '  ┌─────────────────────────────────────────────────┐');
  log('yellow', '  │  ⚠  Plugin code (code.js) was updated           │');
  log('yellow', '  │                                                  │');
  log('white',  '  │  Close and re-run the Figma plugin to apply      │');
  log('white',  '  │  the latest changes.                             │');
  log('white',  '  │                                                  │');
  log('dim',    '  │  Shortcut: ⌘⌥P (Mac)  ·  Ctrl+Alt+P (Windows)  │');
  log('yellow', '  └─────────────────────────────────────────────────┘');
  console.log('');

  // Notify the plugin UI via IPC → server broadcasts to connected plugin
  if (serverProcess && serverProcess.connected) {
    try {
      serverProcess.send({ type: 'code_changed' });
    } catch (e) {
      console.error('  [Figlink] IPC send failed:', e.message);
    }
  }
}

// ─── File watchers ────────────────────────────────────────────────────────────

let serverRestartTimer = null;
let notifyTimer = null;

function watchFiles() {
  // Watch link-server directory for server.js changes
  fs.watch(SERVER_DIR, (event, filename) => {
    if (filename === 'server.js') {
      clearTimeout(serverRestartTimer);
      serverRestartTimer = setTimeout(restartServer, 300);
    }
  });

  // Watch figma-plugin directory for code.js changes
  fs.watch(PLUGIN_DIR, (event, filename) => {
    if (filename === 'code.js') {
      clearTimeout(notifyTimer);
      notifyTimer = setTimeout(notifyCodeChanged, 300);
    }
  });

  log('dim', '  [Watch] Watching link-server/server.js and figma-plugin/code.js');
  log('dim', '  [Watch] Server auto-restarts on server.js changes.');
  log('dim', '  [Watch] You will be prompted to reload the plugin on code.js changes.\n');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  console.log('');
  log('dim', '  [Figlink] Shutting down…');
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ─── Mac double-click hint ────────────────────────────────────────────────────

function checkMacLauncher() {
  if (process.platform !== 'darwin') return;
  const commandFile = path.join(ROOT, 'Start Figlink.command');
  if (!fs.existsSync(commandFile)) return;
  try {
    fs.accessSync(commandFile, fs.constants.X_OK);
    // Already executable — no hint needed
  } catch {
    console.log(`${Y}  ⓘ  To enable double-click launch on Mac, run this once in Terminal:${R}`);
    console.log(`${W}     chmod +x "${commandFile}"${R}`);
    console.log('');
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

printBanner();
checkMacLauncher();
ensureDeps();
activePrompt = loadActivePrompt();
log('purple', `  Active prompt: ${activePrompt.id}\n`);
log('purple', '  Starting link server…\n');
startServer();
watchFiles();

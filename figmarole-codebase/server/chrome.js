'use strict';

const { spawn, execSync } = require('child_process');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');

const DEBUG_PORT = 7333; // Changed from 9222 to avoid conflicts with standard Chrome debugging

let _chromePid = null; // track spawned PID for optional shutdown

// Chrome/Chromium/Edge executable locations per platform
const CHROME_PATHS = {
  win32: [
    () => join(env('PROGRAMFILES'),       'Google\\Chrome\\Application\\chrome.exe'),
    () => join(env('PROGRAMFILES(X86)'),  'Google\\Chrome\\Application\\chrome.exe'),
    () => join(env('LOCALAPPDATA'),       'Google\\Chrome\\Application\\chrome.exe'),
    () => join(env('PROGRAMFILES'),       'Microsoft\\Edge\\Application\\msedge.exe'),
    () => join(env('PROGRAMFILES(X86)'),  'Microsoft\\Edge\\Application\\msedge.exe'),
    () => join(env('LOCALAPPDATA'),       'Microsoft\\Edge\\Application\\msedge.exe'),
    () => join(env('PROGRAMFILES'),       'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
  ],
  darwin: [
    () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    () => '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    () => '/Applications/Chromium.app/Contents/MacOS/Chromium',
    () => '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    () => '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    () => '/usr/bin/google-chrome',
    () => '/usr/bin/google-chrome-stable',
    () => '/usr/bin/chromium',
    () => '/usr/bin/chromium-browser',
    () => '/snap/bin/chromium',
    () => '/usr/bin/microsoft-edge',
  ],
};

function env(key) {
  return process.env[key] || '';
}

function join(...parts) {
  return parts.filter(Boolean).join(path.sep);
}

function findChrome() {
  const platform = os.platform();
  const paths = CHROME_PATHS[platform] || CHROME_PATHS.linux;
  for (const getPath of paths) {
    try {
      const p = getPath();
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function isDebugPortOpen() {
  return new Promise(resolve => {
    const req = http.get(
      { hostname: '127.0.0.1', port: DEBUG_PORT, path: '/json/version', timeout: 1500 },
      res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const versionInfo = JSON.parse(data);
            // Verify this is actually a Chromium browser that supports CDP
            if (versionInfo && versionInfo.Browser && (versionInfo.Browser.includes('Chrome') || versionInfo.Browser.includes('Edge') || versionInfo.Browser.includes('HeadlessChrome'))) {
              // Now that we know it's Chrome, let's also ensure it's not totally locked up
              http.get({ hostname: '127.0.0.1', port: DEBUG_PORT, path: '/json/list', timeout: 1500 }, listRes => {
                let listData = '';
                listRes.on('data', c => listData += c);
                listRes.on('end', () => {
                   try {
                     JSON.parse(listData);
                     resolve(true); // Valid Chrome instance that responds to /json/list
                   } catch(e) {
                     resolve(false);
                   }
                });
              }).on('error', () => resolve(false)).on('timeout', function() { this.destroy(); resolve(false); });
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const CONFIG_PATH = path.join(os.homedir(), '.figmarole.json');

function getSavedBrowser() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (cfg.browserPath && fs.existsSync(cfg.browserPath)) return cfg.browserPath;
    }
  } catch (e) {}
  return null;
}

function saveBrowser(browserPath) {
  try {
    let cfg = {};
    if (fs.existsSync(CONFIG_PATH)) {
      try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
    }
    if (browserPath) cfg.browserPath = browserPath;
    else delete cfg.browserPath;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {}
}

function promptForBrowserAsync() {
  return new Promise(resolve => {
    const platform = os.platform();
    if (platform === 'win32') {
      const ps = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Executables (*.exe)|*.exe'; $f.Title = 'Figmarole: Select your Web Browser (Chrome, Edge, Brave, etc.)'; $f.InitialDirectory = ${env:ProgramFiles}; $res = $f.ShowDialog(); if ($res -eq 'OK') { Write-Output $f.FileName }";
      const child = spawn('powershell.exe', ['-STA', '-NoProfile', '-Command', ps]);
      let out = '';
      child.stdout.on('data', d => out += d);
      child.on('close', () => resolve(out.trim() || null));
    } else if (platform === 'darwin') {
      const script = 'set f to choose file with prompt "Figmarole: Select your Web Browser (e.g. Google Chrome.app):" of type {"app"}\nPOSIX path of f';
      const child = spawn('osascript', ['-e', script]);
      let out = '';
      child.stdout.on('data', d => out += d);
      child.on('close', () => {
         let p = out.trim();
         if (p && p.endsWith('.app')) {
             const appName = path.basename(p, '.app');
             const binPath = path.join(p, 'Contents', 'MacOS', appName);
             if (fs.existsSync(binPath)) {
                 p = binPath;
             } else {
                 try {
                    const macosDir = path.join(p, 'Contents', 'MacOS');
                    const files = fs.readdirSync(macosDir);
                    if (files.length > 0) p = path.join(macosDir, files[0]);
                 } catch(e){}
             }
         }
         resolve(p || null);
      });
    } else {
      resolve(null);
    }
  });
}

async function ensureChrome(customPath) {
  if (await isDebugPortOpen()) {
    // Verify the existing Chrome can actually provide a usable debuggable tab.
    // A zombie/broken headless process can pass isDebugPortOpen() but fail here.
    const usable = await new Promise(resolve => {
      const req = http.get(
        { hostname: '127.0.0.1', port: DEBUG_PORT, path: '/json/new', timeout: 3000 },
        res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const tab = JSON.parse(data);
              if (tab && tab.webSocketDebuggerUrl) {
                // Close the probe tab immediately — we just needed to confirm it works
                http.get(
                  { hostname: '127.0.0.1', port: DEBUG_PORT, path: `/json/close/${tab.id}`, timeout: 2000 },
                  r => r.resume()
                ).on('error', () => {});
                resolve(true);
              } else {
                resolve(false);
              }
            } catch { resolve(false); }
          });
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    if (usable) {
      console.log(`[chrome] Debug port ${DEBUG_PORT} already open — reusing.`);
      return;
    }

    console.log(`[chrome] Existing Chrome on port ${DEBUG_PORT} is not usable — killing and restarting.`);
    killZombieChromes();
    await sleep(800);
  }

  let execPath = customPath || getSavedBrowser() || findChrome();

  if (!execPath) {
    throw new Error(
      'No Chrome, Chromium, or Edge installation found.\n' +
      'Please select your browser executable in the Figma plugin.'
    );
  }

  // Force-kill any lingering headless instances holding our specific port
  killZombieChromes();

  console.log(`[chrome] Launching headless: ${execPath}`);

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${path.join(os.tmpdir(), 'figmarole-chrome-profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--disable-translate',
    '--disable-sync',
    '--no-sandbox',
    '--headless=new',
    'about:blank',
  ];

  const proc = spawn(execPath, args, {
    detached:    true,
    stdio:       'ignore',
    windowsHide: true,
  });
  proc.unref(); // Don't block the Node process from exiting
  _chromePid = proc.pid;

  // Poll until Chrome is ready (max 12 seconds)
  for (let i = 0; i < 24; i++) {
    await sleep(500);
    if (await isDebugPortOpen()) {
      console.log('[chrome] Ready.');
      return;
    }
  }

  saveBrowser(null); // Clear saved browser in case the executable was invalid
  throw new Error('Browser did not start within 12 seconds. The selected executable might be invalid.');
}

// Attempt to cleanly kill a Chrome we launched (best-effort, non-fatal)
function stopChrome() {
  if (!_chromePid) return;
  try { process.kill(_chromePid, 'SIGTERM'); } catch (_) {}
  _chromePid = null;
}

// Aggressively hunt down any Chrome processes holding our specific debug port
function killZombieChromes() {
  try {
    if (os.platform() === 'win32') {
      const out = execSync(`netstat -ano | findstr :${DEBUG_PORT}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' }); } catch (_) {}
      }
    } else {
      execSync(`lsof -ti tcp:${DEBUG_PORT} | xargs kill -9`, { shell: true, stdio: 'pipe' });
    }
  } catch (e) {
    // Ignore errors if no process found or commands fail
  }
}

module.exports = { ensureChrome, findChrome, stopChrome, DEBUG_PORT, promptForBrowserAsync, getSavedBrowser, saveBrowser };

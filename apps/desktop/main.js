// World Studio desktop shell: a window onto the checkout's studio daemon. If a daemon is already
// running for the checkout (say, from `bun run dev` in a terminal) the app attaches to it, so the
// browser and the app share one harness. Otherwise it starts one in a utilityProcess and stops it
// again on quit. No browser, no terminal, no visible localhost.
import { app, BrowserWindow, dialog, shell, utilityProcess } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let daemon = null; // the utilityProcess, only when this app started the daemon
let win = null;
let origin = '';

// --- logging: no terminal when launched from Finder, so mirror console to a file
const logFile = path.join(app.getPath('logs'), 'main.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
for (const level of ['log', 'info', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    logStream.write(`[${new Date().toISOString()}] ${level} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`);
  };
}

// Apps launched from Finder get a bare PATH (/usr/bin:/bin:...) and none of the shell's exports, so
// `claude` and `npx` aren't found and DEVCHAT_* settings are lost. Ask the user's login shell for them,
// like fix-path does. Only PATH and the harness's own DEVCHAT_* variables are copied.
const SHELL_VARS = /^(PATH|DEVCHAT_\w+)$/;
function fixPath() {
  const shellBin = process.env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shellBin, ['-ilc', 'printf "__WS_ENV__"; env -0; printf "__WS_ENV__"'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const body = out.split('__WS_ENV__')[1] || '';
    for (const entry of body.split('\0')) {
      const i = entry.indexOf('=');
      const key = entry.slice(0, i);
      if (i > 0 && SHELL_VARS.test(key) && (key === 'PATH' || !(key in process.env))) process.env[key] = entry.slice(i + 1);
    }
  } catch (err) {
    console.warn('Could not read environment from login shell:', err.message);
  }
  const home = app.getPath('home');
  const extra = [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const parts = (process.env.PATH || '').split(':');
  process.env.PATH = [...parts, ...extra.filter((p) => !parts.includes(p))].join(':');
  try {
    console.log('claude CLI:', execFileSync('/usr/bin/which', [process.env.DEVCHAT_CLAUDE || 'claude'], { encoding: 'utf8' }).trim());
  } catch {
    console.warn('claude CLI not found on PATH:', process.env.PATH);
  }
}

// The workspace is a World Studio checkout (vite.config.js, the daemon, node_modules/).
const DAEMON = 'packages/server/src/cli.ts';
const isWorkspace = (dir) =>
  !!dir && fs.existsSync(path.join(dir, 'vite.config.js')) && fs.existsSync(path.join(dir, DAEMON)) && fs.existsSync(path.join(dir, 'node_modules/vite/package.json'));
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function resolveRoot() {
  const candidates = [
    process.env.WORLD_STUDIO_ROOT,
    readJSON(configFile())?.root,
    readJSON(path.join(here, 'root.json'))?.root, // written by desktop/package.mjs
    app.isPackaged ? null : path.resolve(here, '../..'),
  ];
  const found = candidates.find(isWorkspace);
  if (found) return found;
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose your World Studio folder',
    message: 'Choose the World Studio folder (the one with vite.config.js and node_modules).',
    properties: ['openDirectory'],
  });
  if (canceled || !isWorkspace(filePaths[0])) return null;
  fs.writeFileSync(configFile(), JSON.stringify({ root: filePaths[0] }, null, 2));
  return filePaths[0];
}

// Attach to the checkout's running daemon, or start one. WORLD_STUDIO_ISOLATED=1 (tests) always
// starts a private daemon on a free port without touching the lock.
async function attachOrSpawn(root) {
  const isolated = process.env.WORLD_STUDIO_ISOLATED === '1';
  if (!isolated) {
    const { findDaemon } = await import(pathToFileURL(path.join(root, 'packages/server/src/lock.ts')).href);
    const running = await findDaemon(root);
    if (running) {
      console.log(`Attached to the running daemon at ${running.url} (pid ${running.pid})`);
      return running.url;
    }
  }
  const args = ['--root', root, ...(isolated ? ['--no-lock', '--port', '0'] : [])];
  const child = utilityProcess.fork(path.join(root, DAEMON), args, { cwd: root, env: process.env, stdio: 'pipe', serviceName: 'World Studio daemon' });
  child.stdout.on('data', (d) => console.log(String(d).trimEnd()));
  child.stderr.on('data', (d) => console.error(String(d).trimEnd()));
  const msg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The studio daemon did not start within 60 s')), 60_000);
    child.on('message', (m) => {
      if (!['ready', 'attached', 'error'].includes(m?.type)) return;
      clearTimeout(timer);
      resolve(m);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The studio daemon exited (code ${code})`));
    });
  });
  if (msg.type === 'error') throw new Error(msg.message);
  if (msg.type === 'attached') {
    console.log(`Another daemon won the start race; attached to ${msg.url}`);
    return msg.url;
  }
  daemon = child;
  child.once('exit', (code) => {
    daemon = null;
    console.warn(`Studio daemon exited (code ${code})`);
  });
  console.log(`Started the studio daemon at ${msg.url} (root ${root})`);
  return msg.url;
}

function createWindow(url) {
  origin = new URL(url).origin;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'World Studio',
    backgroundColor: '#05080d',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => (win = null));

  // Links that leave the app open in the default browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(origin)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(target);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => console.error('Renderer gone:', details.reason));

  win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('World Studio');
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    fixPath();
    try {
      const root = await resolveRoot();
      if (!root) return app.quit();
      const url = await attachOrSpawn(root);
      createWindow(url);
      app.on('activate', () => {
        if (!win) createWindow(url);
      });
    } catch (err) {
      console.error(err);
      dialog.showErrorBox('World Studio could not start', `${err.message}\n\nLog: ${logFile}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());

  // Stop the daemon (and with it any running agent jobs) before exiting, but only if this app
  // started it. A daemon from a terminal keeps serving the browser.
  let closing = false;
  app.on('before-quit', (e) => {
    if (!daemon || closing) return;
    closing = true;
    e.preventDefault();
    const child = daemon;
    const done = () => {
      daemon = null;
      app.quit();
    };
    const timer = setTimeout(() => {
      child.kill();
      done();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    child.postMessage({ type: 'shutdown' });
  });
}

// World Studio desktop shell: runs the Vite dev server (with the harness plugin) inside the
// Electron main process and shows it in a window. No browser, no terminal, no visible localhost.
import { app, BrowserWindow, dialog, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5199; // own port so a terminal `npm run dev` on 5173 doesn't collide, and localStorage stays put

let server = null;
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

// Apps launched from Finder get a bare PATH (/usr/bin:/bin:...), so `claude` and `npx` aren't found.
// Ask the user's login shell for its PATH, the same thing fix-path does.
function fixPath() {
  const shellBin = process.env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shellBin, ['-ilc', 'printf "__WS_PATH__%s__WS_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/__WS_PATH__(.*)__WS_PATH__/);
    if (m && m[1]) process.env.PATH = m[1];
  } catch (err) {
    console.warn('Could not read PATH from login shell:', err.message);
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

// The workspace is a World Studio checkout (vite.config.js, games/, engine/, node_modules/).
const isWorkspace = (dir) => !!dir && fs.existsSync(path.join(dir, 'vite.config.js')) && fs.existsSync(path.join(dir, 'node_modules/vite/package.json'));
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
    app.isPackaged ? null : path.resolve(here, '..'),
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

async function startServer(root) {
  process.chdir(root);
  const vite = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  server = await vite.createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    server: { port: PORT, strictPort: false, open: false },
    clearScreen: false,
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] || `http://localhost:${server.config.server.port}/`;
  console.log(`Vite ready at ${url} (root ${root})`);
  return url;
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
      const url = await startServer(root);
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

  // Close Vite (and with it any running agent jobs) before exiting.
  let closing = false;
  app.on('before-quit', (e) => {
    if (!server || closing) return;
    closing = true;
    e.preventDefault();
    const done = () => {
      server = null;
      app.quit();
    };
    Promise.race([server.close(), new Promise((r) => setTimeout(r, 3000))]).then(done, done);
  });
}

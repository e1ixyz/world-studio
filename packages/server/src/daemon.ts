// The World Studio daemon: one Node process per checkout that owns the harness (chats, agent
// jobs, checkpoints, reloads) and serves the studio, games and engine through Vite in middleware
// mode. The browser and the desktop app are both just clients of it.
//
// Started by `bun run dev` (cli.ts) or by the desktop app (Electron utilityProcess). Runs on
// plain Node 24, which strips the TypeScript types itself.
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ID, claimLock, findDaemon, releaseLock, writeLock } from './lock.ts';

export const DAEMON_VERSION = 1;
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface DaemonOptions {
  root: string;
  port?: number;
  strictPort?: boolean;
  // Tests run their own daemon next to a real one; they skip the lock.
  lock?: boolean;
}

export type StartResult =
  | { kind: 'started'; url: string; port: number; close: () => Promise<void> }
  | { kind: 'attached'; url: string };

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as { port: number }).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, 'localhost');
  });
}

export async function startDaemon({ root, port = 5173, strictPort = false, lock = true }: DaemonOptions): Promise<StartResult> {
  root = path.resolve(root);
  if (lock) {
    const running = await findDaemon(root);
    if (running) return { kind: 'attached', url: running.url };
    if (!claimLock(root)) {
      const other = await findDaemon(root);
      if (other) return { kind: 'attached', url: other.url };
      throw new Error('Another World Studio daemon is starting for this folder');
    }
  }

  const startedAt = Date.now();
  let vite: import('vite').ViteDevServer | null = null;
  const httpServer = http.createServer((req, res) => {
    // Only this machine, and only by a loopback name: blocks DNS rebinding, since the chat can edit files.
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('World Studio only answers on localhost');
      return;
    }
    if (req.url === '/__harness/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: APP_ID, root, pid: process.pid, version: DAEMON_VERSION, startedAt }));
      return;
    }
    if (!vite) {
      res.writeHead(503).end('Starting');
      return;
    }
    vite.middlewares(req, res);
  });

  let bound = 0;
  try {
    for (let p = port, tries = 0; ; p++, tries++) {
      try {
        bound = await listen(httpServer, p);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || strictPort || port === 0 || tries > 20) throw err;
      }
    }
    // The checkout's own Vite, so the daemon always matches the vite.config.js next to it.
    const { createServer } = (await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href)) as typeof import('vite');
    vite = await createServer({
      root,
      configFile: path.join(root, 'vite.config.js'),
      appType: 'mpa',
      clearScreen: false,
      server: { middlewareMode: true, ws: { server: httpServer } }, // hmr.overlay stays off via vite.config.js
    });
  } catch (err) {
    if (lock) releaseLock(root);
    httpServer.close();
    throw err;
  }

  const url = `http://localhost:${bound}/`;
  if (lock) writeLock({ app: APP_ID, pid: process.pid, port: bound, url, root, version: DAEMON_VERSION, startedAt });

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      if (lock) releaseLock(root);
      // vite.close() runs the plugins' closeBundle hooks, which stop running agent jobs
      await Promise.race([vite?.close(), new Promise((r) => setTimeout(r, 3000))]);
      httpServer.closeAllConnections();
      await new Promise((r) => httpServer.close(() => r(null)));
    })());
  return { kind: 'started', url, port: bound, close };
}

// ---- run as a process: `node daemon.ts --root <dir> [--port N] [--strict-port] [--no-lock]` ----
type ParentPort = { postMessage(m: unknown): void; on(e: 'message', fn: (e: { data: unknown }) => void): void };
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

function tell(msg: Record<string, unknown>) {
  if (parentPort) parentPort.postMessage(msg);
  else if (process.send) process.send(msg);
}

export function parseArgs(argv: string[]): DaemonOptions {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    root: get('--root') || process.env.WORLD_STUDIO_ROOT || process.cwd(),
    port: get('--port') ? Number(get('--port')) : undefined,
    strictPort: argv.includes('--strict-port'),
    lock: !argv.includes('--no-lock'),
  };
}

export async function runDaemonProcess(opts: DaemonOptions) {
  let result: StartResult;
  try {
    result = await startDaemon(opts);
  } catch (err) {
    console.error(err);
    tell({ type: 'error', message: (err as Error).message });
    process.exit(1);
  }
  if (result.kind === 'attached') {
    tell({ type: 'attached', url: result.url });
    return result;
  }
  const { close } = result;
  const stop = async () => {
    await close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);
  parentPort?.on('message', (e) => (e.data as { type?: string })?.type === 'shutdown' && stop());
  tell({ type: 'ready', url: result.url });
  return result;
}

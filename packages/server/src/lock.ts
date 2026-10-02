// One studio daemon per checkout. The daemon records itself in .harness/daemon.json; the terminal
// (`bun run dev`) and the desktop app both read it and attach instead of starting a second server.
import fs from 'node:fs';
import path from 'node:path';

export const APP_ID = 'world-studio';

export interface DaemonInfo {
  app: typeof APP_ID;
  pid: number;
  port: number;
  url: string;
  root: string;
  version: number;
  startedAt: number;
}

export const lockPath = (root: string) => path.join(root, '.harness', 'daemon.json');

export function readLock(root: string): DaemonInfo | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath(root), 'utf8'));
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// The daemon answers /__harness/health with its root; a lock only counts if that matches.
export async function checkHealth(url: string, root: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(new URL('/__harness/health', url), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string; root?: string };
    return body.app === APP_ID && path.resolve(body.root || '') === path.resolve(root);
  } catch {
    return false;
  }
}

// A running daemon for this checkout, or null. Removes a stale lock it finds on the way.
export async function findDaemon(root: string): Promise<DaemonInfo | null> {
  const info = readLock(root);
  if (!info) return null;
  if (info.url && pidAlive(info.pid) && (await checkHealth(info.url, root))) return info;
  // A daemon that is still starting has a live pid; give it a moment before calling it stale.
  if (pidAlive(info.pid) && !info.url) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const again = readLock(root);
      if (again?.url && (await checkHealth(again.url, root))) return again;
      if (!again || !pidAlive(again.pid)) break;
    }
  }
  if (readLock(root)?.pid === info.pid) fs.rmSync(lockPath(root), { force: true });
  return null;
}

// Claim the lock for this process. Returns false if another live daemon holds it.
export function claimLock(root: string): boolean {
  const file = lockPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, JSON.stringify({ app: APP_ID, pid: process.pid, root, startedAt: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const info = readLock(root);
    if (info && info.pid !== process.pid && pidAlive(info.pid)) return false;
    fs.rmSync(file, { force: true });
    return claimLock(root);
  }
}

export function writeLock(info: DaemonInfo) {
  fs.writeFileSync(lockPath(info.root), `${JSON.stringify(info, null, 2)}\n`);
}

export function releaseLock(root: string) {
  if (readLock(root)?.pid === process.pid) fs.rmSync(lockPath(root), { force: true });
}

import fs from 'node:fs';
import path from 'node:path';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

export interface StudioPaths {
  root: string;
  games: string;
  templates: string;
  engine: string;
  data: string; // .harness/
}

export function studioPaths(root: string): StudioPaths {
  root = path.resolve(root);
  const p = { root, games: path.join(root, 'games'), templates: path.join(root, 'templates'), engine: path.join(root, 'engine'), data: path.join(root, '.harness') };
  fs.mkdirSync(p.games, { recursive: true });
  return p;
}

export const gameDir = (p: StudioPaths, slug: string) => path.join(p.games, slug);
export const projectExists = (p: StudioPaths, slug: string) => SLUG_RE.test(slug) && fs.existsSync(path.join(gameDir(p, slug), 'game.js'));
export const relPath = (p: StudioPaths, file?: string) => (file ? path.relative(p.root, file) || file : '');

export function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

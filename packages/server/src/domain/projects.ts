// Projects are folders in games/<slug>/, created by copying templates/<name>/.
import fs from 'node:fs';
import path from 'node:path';
import type { GameMeta, Project, Template } from '@ws/shared';
import type { StudioEvents } from './events.ts';
import { gameDir, projectExists, readJSON, type StudioPaths, writeJSON } from './paths.ts';

export const slugify = (s: string) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'game';

export function newestMtime(dir: string) {
  let t = 0;
  const walk = (d: string, depth: number) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'thumb.jpg' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) depth < 4 && walk(p, depth + 1);
      else t = Math.max(t, fs.statSync(p).mtimeMs);
    }
  };
  try {
    walk(dir, 0);
  } catch {
    /* ignore */
  }
  return t;
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

export interface ProjectHooks {
  isRunning(slug: string): boolean;
  // The project moved to `dest` in the trash; move anything else that belongs to it.
  trashed?(slug: string, dest: string): void;
  // Files the harness copied in, so the watcher doesn't treat them as edits.
  copied(files: string[]): void;
}

export class Projects {
  private p: StudioPaths;
  private events: StudioEvents;
  private hooks: ProjectHooks;
  constructor(p: StudioPaths, events: StudioEvents, hooks: ProjectHooks) {
    this.p = p;
    this.events = events;
    this.hooks = hooks;
  }

  exists(slug: string) {
    return projectExists(this.p, slug);
  }

  meta(slug: string): GameMeta {
    return readJSON(path.join(gameDir(this.p, slug), 'game.json'), {});
  }

  private writeMeta(slug: string, meta: GameMeta) {
    writeJSON(path.join(gameDir(this.p, slug), 'game.json'), meta);
  }

  list(): Project[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.p.games);
    } catch {
      /* none */
    }
    return names
      .filter((s) => this.exists(s))
      .map((slug) => {
        const dir = gameDir(this.p, slug);
        const meta = this.meta(slug);
        const thumb = path.join(dir, 'thumb.jpg');
        const hasThumb = fs.existsSync(thumb);
        return {
          slug,
          name: meta.name || slug,
          template: meta.template || '',
          description: meta.description || '',
          created: meta.created || 0,
          updated: Math.max(meta.updated || 0, newestMtime(dir)),
          thumb: hasThumb ? `/games/${slug}/thumb.jpg?v=${Math.round(fs.statSync(thumb).mtimeMs)}` : null,
          running: this.hooks.isRunning(slug),
        };
      })
      .sort((a, b) => b.updated - a.updated);
  }

  templates(): Template[] {
    return fs
      .readdirSync(this.p.templates)
      .filter((t) => fs.existsSync(path.join(this.p.templates, t, 'game.js')))
      .map((t) => ({ id: t, ...readJSON<GameMeta>(path.join(this.p.templates, t, 'game.json'), { name: t }) }));
  }

  template(id: string): GameMeta | null {
    if (!id || !fs.existsSync(path.join(this.p.templates, id, 'game.js'))) return null;
    return readJSON(path.join(this.p.templates, id, 'game.json'), {});
  }

  uniqueSlug(name: string) {
    const base = slugify(name);
    let s = base;
    for (let i = 2; fs.existsSync(gameDir(this.p, s)); i++) s = `${base}-${i}`;
    return s;
  }

  create({ name, template, description }: { name?: string; template: string; description?: string }) {
    const title = String(name || '').trim() || 'Untitled game';
    const tmeta = this.template(template);
    if (!tmeta) throw new Error('Unknown template');
    const slug = this.uniqueSlug(title);
    const dir = gameDir(this.p, slug);
    fs.cpSync(path.join(this.p.templates, template), dir, { recursive: true });
    this.hooks.copied(listFiles(dir));
    this.writeMeta(slug, {
      name: title,
      template,
      description: String(description || '').trim() || tmeta.description || '',
      created: Date.now(),
      updated: Date.now(),
    });
    this.events.emit('projects');
    return { slug, templateName: tmeta.name || template };
  }

  rename(slug: string, name?: string) {
    this.writeMeta(slug, { ...this.meta(slug), name: String(name || '').trim() || slug });
    this.events.emit('projects');
  }

  duplicate(slug: string, name?: string) {
    const meta = this.meta(slug);
    const title = String(name || `${meta.name || slug} copy`).trim();
    const copy = this.uniqueSlug(title);
    fs.cpSync(gameDir(this.p, slug), gameDir(this.p, copy), { recursive: true });
    this.hooks.copied(listFiles(gameDir(this.p, copy)));
    this.writeMeta(copy, { ...meta, name: title, created: Date.now(), updated: Date.now() });
    this.events.emit('projects');
    return copy;
  }

  // Moves the game (and its chat folder) into .harness/trash/<slug>-<time>/.
  trash(slug: string) {
    const dest = path.join(this.p.data, 'trash', `${slug}-${Date.now()}`);
    fs.mkdirSync(dest, { recursive: true });
    fs.renameSync(gameDir(this.p, slug), path.join(dest, 'game'));
    const chatDir = path.join(this.p.data, 'projects', slug);
    if (fs.existsSync(chatDir)) fs.renameSync(chatDir, path.join(dest, 'chat'));
    this.hooks.trashed?.(slug, dest);
    this.events.emit('projects');
  }

  touch(slug: string) {
    if (this.exists(slug)) this.writeMeta(slug, { ...this.meta(slug), updated: Date.now() });
  }

  saveThumb(slug: string, data: Buffer) {
    fs.writeFileSync(path.join(gameDir(this.p, slug), 'thumb.jpg'), data);
    this.events.emit('projects');
  }

  saveTweaks(slug: string, values: Record<string, unknown>) {
    writeJSON(path.join(gameDir(this.p, slug), 'tweaks.json'), values);
  }

  saveShot(slug: string, data: Buffer) {
    const file = path.join(this.p.data, 'shots', slug, `${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return file;
  }
}

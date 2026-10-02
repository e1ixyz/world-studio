// Folder-copy checkpoints: .harness/checkpoints/<slug>/<id>/{game,engine?,meta.json}.
import fs from 'node:fs';
import path from 'node:path';
import type { CheckpointMeta } from '@ws/shared';
import { gameDir, readJSON, type StudioPaths, writeJSON } from '../paths.ts';
import type { CheckpointStore } from './store.ts';

export const MAX_CHECKPOINTS = 30;

export class FsCheckpointStore implements CheckpointStore {
  private p: StudioPaths;
  constructor(p: StudioPaths) {
    this.p = p;
  }

  private dir(slug: string) {
    return path.join(this.p.data, 'checkpoints', slug);
  }

  create(slug: string, { prompt, engine }: { prompt: string; engine: boolean }) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const dir = path.join(this.dir(slug), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(gameDir(this.p, slug), path.join(dir, 'game'), { recursive: true, filter: (s) => !s.endsWith('thumb.jpg') });
    if (engine) fs.cpSync(this.p.engine, path.join(dir, 'engine'), { recursive: true });
    writeJSON(path.join(dir, 'meta.json'), { id, prompt, time: Date.now(), engine: !!engine });
    for (const old of this.list(slug).slice(MAX_CHECKPOINTS)) fs.rmSync(path.join(this.dir(slug), old.id), { recursive: true, force: true });
    return id;
  }

  list(slug: string): CheckpointMeta[] {
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(this.dir(slug));
    } catch {
      /* none yet */
    }
    return ids
      .map((id) => readJSON<CheckpointMeta | null>(path.join(this.dir(slug), id, 'meta.json'), null))
      .filter((m): m is CheckpointMeta => !!m)
      .sort((a, b) => b.time - a.time);
  }

  restore(slug: string, id: string) {
    const dir = path.join(this.dir(slug), id);
    const meta = readJSON<CheckpointMeta | null>(path.join(dir, 'meta.json'), null);
    if (!meta) throw new Error('No such checkpoint');
    const engine = fs.existsSync(path.join(dir, 'engine'));
    this.create(slug, { prompt: `Before restoring: ${meta.prompt}`, engine });
    const game = gameDir(this.p, slug);
    const thumb = path.join(game, 'thumb.jpg');
    const thumbData = fs.existsSync(thumb) ? fs.readFileSync(thumb) : null;
    fs.rmSync(game, { recursive: true, force: true });
    fs.cpSync(path.join(dir, 'game'), game, { recursive: true });
    if (thumbData) fs.writeFileSync(thumb, thumbData);
    if (engine) {
      fs.rmSync(this.p.engine, { recursive: true, force: true });
      fs.cpSync(path.join(dir, 'engine'), this.p.engine, { recursive: true });
    }
    return { meta, engine };
  }
}

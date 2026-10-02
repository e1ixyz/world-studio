import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatFile, CheckpointMeta, GameMeta, Settings } from '../../packages/shared/src/schemas.ts';

// The schemas describe data the harness already wrote. Every real file must still parse.
const root = path.resolve(import.meta.dirname, '../..');
const glob = (dir, file) => {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).map((n) => path.join(d, n, file)).filter((f) => fs.existsSync(f));
};
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

describe('shared schemas match existing data', () => {
  it('chat logs', () => {
    for (const f of glob('.harness/projects', 'chat.json')) expect(ChatFile.safeParse(read(f)).error, f).toBeUndefined();
  });
  it('game.json files', () => {
    for (const f of [...glob('games', 'game.json'), ...glob('templates', 'game.json')]) expect(GameMeta.safeParse(read(f)).error, f).toBeUndefined();
  });
  it('checkpoint metas', () => {
    for (const dir of glob('.harness/checkpoints', '')) {
      for (const f of glob(path.relative(root, dir), 'meta.json')) expect(CheckpointMeta.safeParse(read(f)).error, f).toBeUndefined();
    }
  });
  it('settings', () => {
    const f = path.join(root, '.harness/settings.json');
    if (fs.existsSync(f)) expect(Settings.safeParse(read(f)).error).toBeUndefined();
  });
});

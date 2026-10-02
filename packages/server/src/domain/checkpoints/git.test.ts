import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioPaths } from '../paths.ts';
import { FsCheckpointStore } from './fs.ts';
import { GitCheckpointStore } from './git.ts';

let root: string;
const game = (...p: string[]) => path.join(root, 'games', 'g', ...p);
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-git-'));
  write(game('game.js'), 'export default 1;\n');
  write(game('thumb.jpg'), 'jpg');
  write(path.join(root, 'engine', 'index.js'), 'export const v = 1;\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('GitCheckpointStore', () => {
  it('records what each prompt changed and restores it', () => {
    const store = new GitCheckpointStore(studioPaths(root));
    const id = store.create('g', { prompt: 'add a city\nwith details', engine: false });
    write(game('game.js'), 'export default 2;\nexport const city = true;\n');
    write(game('city.js'), 'x\n');
    store.settle('g', id);

    const [cp] = store.list('g');
    expect(cp).toMatchObject({ id, prompt: 'add a city\nwith details', engine: false, files: 2, additions: 3, deletions: 1 });
    const diff = store.diff('g', id);
    expect(diff?.files.map((f) => f.path).sort()).toEqual(['city.js', 'game.js']);
    expect(diff?.patch).toContain('+export const city = true;');
    expect(diff?.patch).not.toContain('thumb.jpg');

    write(game('thumb.jpg'), 'newer jpg');
    store.restore('g', id);
    expect(fs.readFileSync(game('game.js'), 'utf8')).toBe('export default 1;\n');
    expect(fs.existsSync(game('city.js'))).toBe(false);
    expect(fs.readFileSync(game('thumb.jpg'), 'utf8')).toBe('newer jpg'); // thumbnail kept

    // the restore saved the state before it, so it can be undone
    const undo = store.list('g')[0];
    expect(undo.prompt).toBe('Before restoring: add a city\nwith details');
    store.restore('g', undo.id);
    expect(fs.existsSync(game('city.js'))).toBe(true);
  });

  it('checkpoints and restores the engine when asked', () => {
    const store = new GitCheckpointStore(studioPaths(root));
    const id = store.create('g', { prompt: 'engine tweak', engine: true });
    write(path.join(root, 'engine', 'index.js'), 'export const v = 2;\n');
    store.settle('g', id);
    expect(store.list('g')[0].engine).toBe(true);
    expect(store.diff('g', id)?.files.map((f) => f.path)).toEqual(['engine/index.js']);
    const r = store.restore('g', id);
    expect(r.engine).toBe(true);
    expect(fs.readFileSync(path.join(root, 'engine', 'index.js'), 'utf8')).toBe('export const v = 1;\n');
  });

  it('still lists and restores folder checkpoints from before', () => {
    const paths = studioPaths(root);
    const old = new FsCheckpointStore(paths).create('g', { prompt: 'old prompt', engine: false });
    write(game('game.js'), 'changed\n');
    const store = new GitCheckpointStore(paths);
    expect(store.list('g')).toMatchObject([{ id: old, legacy: true, prompt: 'old prompt' }]);
    store.restore('g', old);
    expect(fs.readFileSync(game('game.js'), 'utf8')).toBe('export default 1;\n');
    expect(store.list('g').find((m) => !m.legacy)?.prompt).toBe('Before restoring: old prompt');
  });

  it('moves the history into the trash with the project', () => {
    const store = new GitCheckpointStore(studioPaths(root));
    store.create('g', { prompt: 'x', engine: false });
    const dest = path.join(root, '.harness', 'trash', 'g-1');
    fs.mkdirSync(dest, { recursive: true });
    store.trash('g', dest);
    expect(fs.existsSync(path.join(dest, 'history.git', 'HEAD'))).toBe(true);
    expect(store.list('g')).toEqual([]);
  });
});

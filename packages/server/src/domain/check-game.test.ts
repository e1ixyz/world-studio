import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkGame, diagKey, formatCheck } from './check-game.ts';
import { studioPaths } from './paths.ts';

// Runs real TypeScript against a throwaway game in this checkout (it needs node_modules and engine/).
const p = studioPaths(path.resolve(import.meta.dirname, '../../../..'));
const slug = 'zz-check-game-test';
const dir = path.join(p.games, slug);
const write = (src: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'game.js'), src);
};
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(p.data, 'tsconfig', `${slug}.json`), { force: true });
});

const ok = `import * as THREE from 'three';
import { defineGame, CollisionGrid } from '../../engine/index.js';
export default defineGame({
  title: 'T',
  setup(ctx) {
    const grid = new CollisionGrid(32);
    ctx.scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    ctx.tweaks.add('A / Size', { value: 1, min: 0, max: 4, onChange: (v) => v * 2 });
    ctx.select.add({ kind: 'box', box: [0, 0, 0, 1, 1, 1] });
    return { world: { grid, groundY: () => 0, spawn: { x: 0, z: 0 } }, update(dt) { ctx.env.time += dt * 0; } };
  },
});
`;

describe('checkGame', () => {
  it('passes a correct game', async () => {
    write(ok);
    const r = await checkGame(p, slug);
    expect(r.errors).toEqual([]);
    expect(formatCheck(r, false)).toMatch(/^No new errors/);
  });

  it('catches contract mistakes, syntax errors and bad imports', async () => {
    write(ok.replace('ctx.tweaks.add(', 'ctx.tweaks.ad(').replace("spawn: { x: 0, z: 0 } ", '').replace("'../../engine/index.js'", "'../../engine/index.js';\nimport { nope } from './missing.js'"));
    const r = await checkGame(p, slug);
    const codes = r.errors.map((d) => d.code);
    expect(r.errors.some((d) => d.message.includes("'ad'"))).toBe(true); // tweaks.ad -> add
    expect(codes).toContain('TS2307'); // ./missing.js
    expect(r.errors.some((d) => /spawn/.test(d.message))).toBe(true);
    write(`${ok}\nconst x = ;\n`);
    expect((await checkGame(p, slug)).errors.length).toBeGreaterThan(0);
  });

  it('reports only errors that are not in the baseline', async () => {
    write(ok.replace('ctx.tweaks.add(', 'ctx.tweaks.ad('));
    const before = await checkGame(p, slug);
    const baseline = new Set(before.errors.map(diagKey));
    write(`\n\n${ok.replace('ctx.tweaks.add(', 'ctx.tweaks.ad(').replace('ctx.env.time', 'ctx.env.tim')}`);
    const after = await checkGame(p, slug, baseline);
    expect(after.errors.length).toBe(2);
    expect(after.fresh.map((d) => d.message)).toEqual([expect.stringContaining("'tim'")]);
    expect(formatCheck(after, true)).toContain('1 new error since this prompt started');
  });
});

describe('engine types', () => {
  it('type env.setSky', async () => {
    write(ok.replace('ctx.env.time += dt * 0;', "ctx.env.setSky({ glare: 0.9, mie: 'x' });"));
    const r = await checkGame(p, slug);
    expect(r.errors.map((d) => d.message).join('\n')).toMatch(/string/);
  });
});

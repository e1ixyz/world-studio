import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CliRunner } from './cli-runner.ts';
import type { RunResult } from './runner.ts';

// CliRunner against scripts/fake-claude.mjs, which speaks the CLI's stream-json.
const root = path.resolve(import.meta.dirname, '../../../../..');
const fake = path.join(root, 'scripts/fake-claude.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cli-'));
const game = path.join(dir, 'games', 'g');
fs.mkdirSync(game, { recursive: true });
fs.writeFileSync(path.join(game, 'game.js'), 'export default 1;\n');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(prompt: string, bin = fake) {
  return new Promise<{ session?: string; texts: string[]; tools: string[]; result?: RunResult; exit: { stopped: boolean; error?: string } }>((resolve) => {
    const out: { session?: string; texts: string[]; tools: string[]; result?: RunResult } = { texts: [], tools: [] };
    new CliRunner(bin).start(
      { prompt, cwd: dir, allowedTools: ['Read', `Edit(/${game}/**)`], appendSystemPrompt: 'x' },
      {
        session: (id) => (out.session = id),
        text: (t) => out.texts.push(t),
        tool: (name, input) => out.tools.push(`${name} ${input.file_path ? path.basename(String(input.file_path)) : ''}`.trim()),
        result: (r) => (out.result = r),
        exit: (exit) => resolve({ ...out, exit }),
      },
    );
  });
}

describe('CliRunner', () => {
  it('parses stream-json into events and edits through the fake CLI', async () => {
    const r = await run('add a comment');
    expect(r.session).toMatch(/^fake-/);
    expect(r.tools).toEqual(['Read game.js', 'Edit game.js']);
    expect(r.result).toMatchObject({ ok: true, subtype: 'success', cost: 0, denials: [] });
    expect(r.exit).toEqual({ stopped: false });
    expect(fs.readFileSync(path.join(game, 'game.js'), 'utf8')).toContain('// fake-agent: add a comment');
  });

  it('reports denials and failures', async () => {
    const r = await run('x [deny] [fail] [noedit]');
    expect(r.result?.ok).toBe(false);
    expect(r.result?.denials[0].tool_input?.file_path).toMatch(/engine\/core\/app\.js$/);
  });

  it('explains a missing CLI', async () => {
    const r = await run('x', '/no/such/claude');
    expect(r.exit.error).toMatch(/Couldn’t find the `claude` command-line tool/);
  });
});

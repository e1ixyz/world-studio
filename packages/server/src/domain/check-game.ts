// Fast type and syntax check of one game: TypeScript (checkJs) over games/<slug>/, with the engine
// contract types from engine/types.d.ts. About a quarter second, so the agent can run it after
// every change instead of a full `vite build`. Existing games carry some errors; callers pass a
// baseline taken before the prompt so only errors the prompt introduced are reported.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gameDir, type StudioPaths, writeJSON } from './paths.ts';

const run = promisify(execFile);

export interface GameDiagnostic {
  file: string; // relative to the repo root
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  errors: GameDiagnostic[];
  // errors not in the baseline (all errors when there is no baseline)
  fresh: GameDiagnostic[];
  ms: number;
}

// Line numbers move with every edit, so a diagnostic's identity is file + code + message.
export const diagKey = (d: GameDiagnostic) => `${d.file}\t${d.code}\t${d.message}`;

function tsconfigFor(p: StudioPaths, slug: string) {
  const file = path.join(p.data, 'tsconfig', `${slug}.json`);
  writeJSON(file, {
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: false,
      target: 'es2024',
      module: 'esnext',
      moduleResolution: 'bundler',
      lib: ['es2024', 'dom', 'dom.iterable'],
      types: [],
      typeRoots: [path.join(p.root, 'node_modules/@types')],
      skipLibCheck: true,
    },
    include: [path.join(gameDir(p, slug), '**/*.js'), path.join(gameDir(p, slug), '**/*.mjs')],
  });
  return file;
}

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export function parseTsc(out: string, root: string, onlyUnder: string): GameDiagnostic[] {
  const diags: GameDiagnostic[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(LINE);
    if (!m) {
      // continuation lines of a multi-line message
      if (diags.length && /^\s+\S/.test(line)) diags[diags.length - 1].message += ` ${line.trim()}`;
      continue;
    }
    const abs = path.resolve(root, m[1]);
    if (!abs.startsWith(onlyUnder + path.sep)) continue;
    diags.push({ file: path.relative(root, abs), line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] });
  }
  return diags;
}

export async function checkGame(p: StudioPaths, slug: string, baseline?: Set<string>): Promise<CheckResult> {
  const started = Date.now();
  const tsc = path.join(p.root, 'node_modules/.bin/tsc');
  if (!fs.existsSync(tsc)) throw new Error('TypeScript is not installed (node_modules/.bin/tsc); run bun install');
  let out = '';
  try {
    const r = await run(tsc, ['-p', tsconfigFor(p, slug), '--pretty', 'false'], { cwd: p.root, maxBuffer: 16 * 1024 * 1024 });
    out = r.stdout;
  } catch (err) {
    // tsc exits non-zero when it finds errors; the report is still on stdout
    out = (err as { stdout?: string }).stdout || '';
    if (!out) throw err;
  }
  const errors = parseTsc(out, p.root, gameDir(p, slug));
  const fresh = baseline ? errors.filter((d) => !baseline.has(diagKey(d))) : errors;
  return { ok: fresh.length === 0, errors, fresh, ms: Date.now() - started };
}

export function formatCheck(r: CheckResult, hadBaseline: boolean) {
  if (r.ok) {
    const old = r.errors.length;
    return `No new errors (${r.ms} ms).${old && hadBaseline ? ` ${old} error${old === 1 ? '' : 's'} predate this prompt and can be ignored.` : ''}`;
  }
  const shown = r.fresh.slice(0, 30).map((d) => `${d.file}:${d.line}:${d.col} ${d.code} ${d.message}`);
  const more = r.fresh.length > shown.length ? `\n…and ${r.fresh.length - shown.length} more` : '';
  return `${r.fresh.length} new error${r.fresh.length === 1 ? '' : 's'}${hadBaseline ? ' since this prompt started' : ''}:\n${shown.join('\n')}${more}`;
}

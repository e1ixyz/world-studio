// Git checkpoints: a private repository per project, .harness/git/<slug>.git, whose work tree is
// games/<slug>/, plus .harness/git/engine.git for engine/. Before every prompt the game (and the
// engine, when engine edits are allowed) is committed; when the run ends, its edits are committed
// on top. A checkpoint is the "before" commit, so its diff is exactly what that prompt changed.
// Restoring checks the old tree out and commits, so history only moves forward and every restore
// can be undone. The user's own git repository is never touched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CheckpointDiff, CheckpointMeta } from '@ws/shared';
import { gameDir, type StudioPaths } from '../paths.ts';
import { FsCheckpointStore } from './fs.ts';
import type { CheckpointStore } from './store.ts';

const IDENTITY = ['-c', 'user.name=World Studio', '-c', 'user.email=studio@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const SEP_FIELD = '\x1f';
const SEP_RECORD = '\x1e';

export function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

class Repo {
  gitDir: string;
  workTree: string;
  constructor(gitDir: string, workTree: string) {
    this.gitDir = gitDir;
    this.workTree = workTree;
  }

  git(args: string[], input?: string) {
    return execFileSync('git', [`--git-dir=${this.gitDir}`, `--work-tree=${this.workTree}`, ...IDENTITY, ...args], {
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
  }

  ensure() {
    if (fs.existsSync(path.join(this.gitDir, 'HEAD'))) return;
    fs.mkdirSync(this.gitDir, { recursive: true });
    this.git(['init', '-q', '--initial-branch=main']);
    fs.mkdirSync(path.join(this.gitDir, 'info'), { recursive: true });
    fs.writeFileSync(path.join(this.gitDir, 'info', 'exclude'), 'thumb.jpg\n.DS_Store\n');
  }

  commit(message: string) {
    this.ensure();
    this.git(['add', '-A', '.']);
    this.git(['commit', '-q', '--allow-empty', '--no-verify', '-F', '-'], message);
    return this.git(['rev-parse', 'HEAD']).trim();
  }

  has(rev: string) {
    try {
      this.git(['cat-file', '-e', `${rev}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  checkout(rev: string) {
    // Make the work tree match `rev` exactly. Ignored files (thumb.jpg) stay.
    this.git(['read-tree', '-u', '--reset', rev]);
  }
}

interface Commit {
  sha: string;
  subject: string;
  trailers: Record<string, string>;
}

function parseLog(out: string): Commit[] {
  return out
    .split(SEP_RECORD)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, trailerBlock = ''] = r.split(SEP_FIELD);
      const trailers: Record<string, string> = {};
      for (const line of trailerBlock.split('\n')) {
        const i = line.indexOf(':');
        if (i > 0) trailers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      return { sha, subject, trailers };
    });
}

const trailers = (t: Record<string, string | number | boolean>) =>
  Object.entries(t)
    .map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, ' ')}`)
    .join('\n');

export class GitCheckpointStore implements CheckpointStore {
  private p: StudioPaths;
  private legacy: FsCheckpointStore;
  constructor(p: StudioPaths) {
    this.p = p;
    this.legacy = new FsCheckpointStore(p);
  }

  private repo(slug: string) {
    return new Repo(path.join(this.p.data, 'git', `${slug}.git`), gameDir(this.p, slug));
  }
  private engineRepo() {
    return new Repo(path.join(this.p.data, 'git', 'engine.git'), this.p.engine);
  }

  create(slug: string, { prompt, engine }: { prompt: string; engine: boolean }) {
    const time = Date.now();
    const engineSha = engine ? this.engineRepo().commit(`Before ${slug}: ${firstLine(prompt)}\n\n${trailers({ 'Ws-Game': slug, 'Ws-Time': time })}`) : null;
    const t: Record<string, string | number> = { 'Ws-Kind': 'checkpoint', 'Ws-Time': time, 'Ws-Prompt': JSON.stringify(prompt) };
    if (engineSha) t['Ws-Engine'] = engineSha;
    const sha = this.repo(slug).commit(`${firstLine(prompt)}\n\n${trailers(t)}`);
    return sha.slice(0, 12);
  }

  settle(slug: string, id: string) {
    const repo = this.repo(slug);
    if (!repo.has(id)) return;
    repo.commit(`After: ${firstLine(this.meta(slug, id)?.prompt || '')}\n\n${trailers({ 'Ws-Kind': 'after', 'Ws-Run': id, 'Ws-Time': Date.now() })}`);
    const engineSha = this.commitOf(slug, id)?.trailers['Ws-Engine'];
    if (engineSha) this.engineRepo().commit(`After ${slug}\n\n${trailers({ 'Ws-Game': slug, 'Ws-Run': id, 'Ws-Time': Date.now() })}`);
  }

  private log(slug: string): Commit[] {
    const repo = this.repo(slug);
    if (!fs.existsSync(path.join(repo.gitDir, 'HEAD'))) return [];
    try {
      return parseLog(repo.git(['log', `--format=%h${SEP_FIELD}%s${SEP_FIELD}%(trailers:only,unfold)${SEP_RECORD}`, '--abbrev=12']));
    } catch {
      return []; // no commits yet
    }
  }

  private commitOf(slug: string, id: string) {
    return this.log(slug).find((c) => c.sha === id.slice(0, 12));
  }

  private meta(slug: string, id: string): CheckpointMeta | null {
    const c = this.commitOf(slug, id);
    return c ? toMeta(c) : null;
  }

  list(slug: string): CheckpointMeta[] {
    const commits = this.log(slug);
    const after = new Map(commits.filter((c) => c.trailers['Ws-Kind'] === 'after').map((c) => [c.trailers['Ws-Run'], c.sha]));
    const repo = this.repo(slug);
    const metas = commits
      .filter((c) => c.trailers['Ws-Kind'] === 'checkpoint')
      .map((c) => {
        const m = toMeta(c);
        const end = after.get(c.sha);
        if (end) Object.assign(m, numstatTotals(repo.git(['diff', '--numstat', c.sha, end])));
        return m;
      });
    const legacy = this.legacy.list(slug).map((m) => ({ ...m, legacy: true }));
    return [...metas, ...legacy].sort((a, b) => b.time - a.time);
  }

  diff(slug: string, id: string): CheckpointDiff | null {
    const repo = this.repo(slug);
    const c = this.commitOf(slug, id);
    if (!c || c.trailers['Ws-Kind'] !== 'checkpoint') return null;
    const end = this.log(slug).find((x) => x.trailers['Ws-Kind'] === 'after' && x.trailers['Ws-Run'] === c.sha)?.sha;
    // A run still in progress (or one that never settled) diffs against the work tree.
    const range = end ? [c.sha, end] : [c.sha];
    const files = parseNumstat(repo.git(['diff', '--numstat', ...range]));
    const patch = repo.git(['diff', '--no-color', '--no-ext-diff', ...range]);
    const engineSha = c.trailers['Ws-Engine'];
    if (engineSha) {
      const er = this.engineRepo();
      const eEnd = this.engineAfter(c.sha);
      const eRange = eEnd ? [engineSha, eEnd] : [engineSha];
      files.push(...parseNumstat(er.git(['diff', '--numstat', ...eRange])).map((f) => ({ ...f, path: `engine/${f.path}` })));
      const ePatch = er.git(['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/engine/', '--dst-prefix=b/engine/', ...eRange]);
      return { id: c.sha, files, patch: patch + ePatch };
    }
    return { id: c.sha, files, patch };
  }

  private engineAfter(runId: string) {
    try {
      const out = this.engineRepo().git(['log', `--format=%h${SEP_FIELD}%s${SEP_FIELD}%(trailers:only,unfold)${SEP_RECORD}`, '--abbrev=12']);
      return parseLog(out).find((x) => x.trailers['Ws-Run'] === runId)?.sha;
    } catch {
      return undefined;
    }
  }

  restore(slug: string, id: string) {
    const repo = this.repo(slug);
    if (this.legacy.has(slug, id)) {
      const legacyMeta = this.legacy.list(slug).find((m) => m.id === id);
      const before = this.create(slug, { prompt: `Before restoring: ${legacyMeta?.prompt ?? id}`, engine: !!legacyMeta?.engine });
      this.settle(slug, before);
      const r = this.legacy.restore(slug, id, { saveFirst: false });
      repo.commit(`Restored to before: ${firstLine(r.meta.prompt)}\n\n${trailers({ 'Ws-Kind': 'restore', 'Ws-Restored': id, 'Ws-Time': Date.now() })}`);
      if (r.engine) this.engineRepo().commit(`Restored engine for ${slug}\n\n${trailers({ 'Ws-Game': slug, 'Ws-Restored': id, 'Ws-Time': Date.now() })}`);
      return r;
    }
    if (!/^[0-9a-f]{7,40}$/.test(id) || !repo.has(id)) throw new Error('No such checkpoint');
    const c = this.commitOf(slug, id);
    if (!c) throw new Error('No such checkpoint');
    const meta = toMeta(c);
    const engineSha = c.trailers['Ws-Engine'];
    // Save the current state first, so the restore itself can be undone.
    const before = this.create(slug, { prompt: `Before restoring: ${meta.prompt}`, engine: !!engineSha });
    this.settle(slug, before);
    repo.checkout(c.sha);
    repo.commit(`Restored to before: ${firstLine(meta.prompt)}\n\n${trailers({ 'Ws-Kind': 'restore', 'Ws-Restored': c.sha, 'Ws-Time': Date.now() })}`);
    if (engineSha) {
      const er = this.engineRepo();
      er.checkout(engineSha);
      er.commit(`Restored engine for ${slug}\n\n${trailers({ 'Ws-Game': slug, 'Ws-Restored': engineSha, 'Ws-Time': Date.now() })}`);
    }
    return { meta, engine: !!engineSha };
  }

  trash(slug: string, dest: string) {
    const gitDir = this.repo(slug).gitDir;
    if (fs.existsSync(gitDir)) fs.renameSync(gitDir, path.join(dest, 'history.git'));
  }
}

const firstLine = (s: string) => s.split('\n')[0].slice(0, 200) || '(empty prompt)';

function toMeta(c: Commit): CheckpointMeta {
  let prompt = c.subject;
  try {
    prompt = JSON.parse(c.trailers['Ws-Prompt']);
  } catch {
    /* subject only */
  }
  return { id: c.sha, prompt, time: Number(c.trailers['Ws-Time']) || 0, engine: !!c.trailers['Ws-Engine'] };
}

function parseNumstat(out: string) {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t');
      return { path: rest.join('\t'), additions: a === '-' ? 0 : Number(a), deletions: d === '-' ? 0 : Number(d) };
    });
}

function numstatTotals(out: string) {
  const files = parseNumstat(out);
  return { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
}

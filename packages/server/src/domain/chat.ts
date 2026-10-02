// The per-project chat: its log, its agent job and the subscribers watching it. One job per
// project at a time. Every prompt is checkpointed first, and edits are limited to the game's
// folder (plus engine/ when allowed).
import type { ChatItem, ChatItemKind, ChatState } from '@ws/shared';
import { type AgentRunner, type RunHandle, STUDIO_TOOL_PREFIX, type StudioTool } from './agent/runner.ts';
import { type CheckResult, diagKey, formatCheck } from './check-game.ts';
import type { ChatRepository } from './chat-store.ts';
import type { CheckpointStore } from './checkpoints/store.ts';
import type { StudioEvents } from './events.ts';
import { gameDir, relPath, type StudioPaths } from './paths.ts';
import type { Projects } from './projects.ts';
import { systemPrompt } from './prompts.ts';
import type { SettingsStore } from './settings.ts';

export const MAX_LOG = 400;
export const BASE_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(npx vite build:*)'];

export type ChatEvent = ChatItem | ChatState;
type Listener = (e: ChatEvent) => void;

interface Job {
  handle: RunHandle;
  startedAt: number;
  engine: boolean;
  checkpoint: string;
}

interface Chat {
  slug: string;
  sessionId: string | null;
  seq: number;
  log: ChatItem[];
  listeners: Set<Listener>;
  closers: Set<() => void>;
  job: Job | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  lastJobEnd: number;
}

export class BusyError extends Error {}

export function describeTool(p: StudioPaths, name: string, input: Record<string, any> = {}) {
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'MultiEdit':
      return `${name} ${relPath(p, input.file_path)}`;
    case 'Grep':
      return `Search "${input.pattern}"`;
    case 'Glob':
      return `Find ${input.pattern}`;
    case 'Bash':
      return `Run ${input.command}`;
    case 'TodoWrite':
      return 'Plan steps';
    case 'ToolSearch':
      return 'Load tools';
    case `${STUDIO_TOOL_PREFIX}check_game`:
      return 'Check the game for errors';
    default:
      return name;
  }
}

export interface ChatDeps {
  paths: StudioPaths;
  repo: ChatRepository;
  runner: AgentRunner;
  checkpoints: CheckpointStore;
  projects: Projects;
  settings: SettingsStore;
  events: StudioEvents;
  // Fast type/syntax check of a game, offered to the agent as check_game when the runner hosts tools.
  checkGame?(slug: string, baseline?: Set<string>): Promise<CheckResult>;
  // Told when a job ends, so pending reloads can flush.
  onJobEnd(slug: string): void;
  // Restores wrote files the watcher will report; reloads are sent by the chat itself.
  onRestore(slug: string, engine: boolean): void;
}

export class ChatService {
  private chats = new Map<string, Chat>();
  private d: ChatDeps;
  constructor(d: ChatDeps) {
    this.d = d;
  }

  private chat(slug: string): Chat {
    let c = this.chats.get(slug);
    if (!c) {
      const saved = this.d.repo.load(slug);
      c = { slug, sessionId: saved.sessionId || null, seq: saved.seq || 0, log: saved.log || [], listeners: new Set(), closers: new Set(), job: null, saveTimer: null, lastJobEnd: 0 };
      this.chats.set(slug, c);
    }
    return c;
  }

  private save(c: Chat) {
    if (c.saveTimer) clearTimeout(c.saveTimer);
    c.saveTimer = setTimeout(() => this.d.repo.save(c.slug, { sessionId: c.sessionId, seq: c.seq, log: c.log }), 200);
  }

  push(slug: string, kind: ChatItemKind, text: string, meta?: Record<string, unknown>) {
    const c = this.chat(slug);
    const item = { seq: ++c.seq, kind, text, meta, ts: Date.now() } as ChatItem;
    c.log.push(item);
    if (c.log.length > MAX_LOG) c.log.splice(0, c.log.length - MAX_LOG);
    for (const fn of c.listeners) fn(item);
    this.save(c);
    return item;
  }

  state(slug: string): ChatState {
    const c = this.chat(slug);
    return { kind: 'state', running: !!c.job, startedAt: c.job?.startedAt, engine: !!c.job?.engine, session: !!c.sessionId, seq: c.seq };
  }

  private broadcastState(c: Chat) {
    const s = this.state(c.slug);
    for (const fn of c.listeners) fn(s);
    this.d.events.emit('job', { slug: c.slug, running: s.running });
  }

  // Replays items after `since`, then the current state, then streams live. `onClose` runs if the
  // project is deleted. Returns unsubscribe.
  subscribe(slug: string, since: number, fn: Listener, onClose?: () => void) {
    const c = this.chat(slug);
    for (const item of c.log) if (item.seq > since) fn(item);
    fn(this.state(slug));
    c.listeners.add(fn);
    if (onClose) c.closers.add(onClose);
    return () => {
      c.listeners.delete(fn);
      if (onClose) c.closers.delete(onClose);
    };
  }

  isRunning(slug: string) {
    return !!this.chats.get(slug)?.job;
  }

  anyRunning() {
    return [...this.chats.values()].some((c) => c.job);
  }

  recentJobChat(withinMs: number) {
    return [...this.chats.values()].find((c) => c.lastJobEnd && Date.now() - c.lastJobEnd < withinMs)?.slug ?? null;
  }

  prompt(slug: string, prompt: string, { display, engine = false }: { display?: string; engine?: boolean } = {}) {
    const c = this.chat(slug);
    if (c.job) throw new BusyError('Still working on the last request');
    const { paths } = this.d;
    engine = engine || this.d.settings.get().alwaysEngine;
    const meta = this.d.projects.meta(slug);
    const checkpoint = this.d.checkpoints.create(slug, { prompt: display || prompt, engine });
    this.push(slug, 'user', display || prompt, { engine });
    // Absolute paths ("//abs/**"): relative rules resolve against Claude's current directory,
    // so a `cd` in a shell command would otherwise make the game's own files unwritable.
    const allow = (dir: string) => [`Edit(/${dir}/**)`, `Write(/${dir}/**)`];
    const tools = [...BASE_TOOLS, ...allow(gameDir(paths, slug))];
    if (engine) tools.push(...allow(paths.engine));
    const studioTools = this.studioTools(slug);
    tools.push(...studioTools.map((t) => STUDIO_TOOL_PREFIX + t.name));
    const job: Job = { handle: { stop() {} }, startedAt: Date.now(), engine, checkpoint };
    c.job = job;
    job.handle = this.d.runner.start(
      {
        prompt,
        cwd: paths.root,
        allowedTools: tools,
        tools: studioTools,
        appendSystemPrompt: systemPrompt(slug, meta, engine, { checkTool: studioTools.some((t) => t.name === 'check_game') }),
        resume: c.sessionId,
        model: process.env.DEVCHAT_MODEL,
        // WORLD_STUDIO_AGENT lets user-level hooks (e.g. a handoff Stop hook) skip these short in-game runs
        env: { WORLD_STUDIO_AGENT: '1' },
      },
      {
        session: (id) => {
          c.sessionId = id;
        },
        text: (text) => this.push(slug, 'text', text),
        tool: (name, input) => this.push(slug, 'tool', describeTool(paths, name, input), { name }),
        result: (r) => {
          const files = [...new Set(r.denials.filter((d) => d.tool_input?.file_path).map((d) => relPath(paths, d.tool_input?.file_path)))];
          const tools = [...new Set(r.denials.filter((d) => !d.tool_input?.file_path).map((d) => d.tool_name))];
          if (files.length) {
            const engineFiles = files.some((f) => f.startsWith('engine'));
            this.push(
              slug,
              'status',
              `Blocked edits outside this game: ${files.join(', ')}.${engineFiles && !engine ? ' To allow changes to the shared engine, choose "Allow engine edits" (next prompt) or "Always allow engine edits" in the ⋯ menu.' : ''}`,
            );
          }
          if (tools.length)
            this.push(slug, 'status', `Tried tools the harness doesn't allow here (${tools.join(', ')}). Only reading, searching and editing this game's files and running npx vite build are allowed.`);
          if (!r.ok) this.push(slug, 'error', r.text || `Stopped (${r.subtype})`);
          this.push(slug, 'done', '', { ms: r.ms, cost: r.cost });
        },
        exit: ({ stopped, error }) => {
          c.job = null;
          if (stopped) this.push(slug, 'status', 'Stopped. Open Checkpoints to undo any partial edits.');
          else if (error) this.push(slug, 'error', error);
          try {
            this.d.checkpoints.settle?.(slug, checkpoint); // before touch(), so game.json's timestamp isn't part of the diff
          } catch (err) {
            this.push(slug, 'error', `Couldn't record this change in the checkpoint history: ${(err as Error).message}`);
          }
          this.d.projects.touch(slug);
          this.save(c);
          this.broadcastState(c);
          c.lastJobEnd = Date.now();
          this.d.onJobEnd(slug);
        },
      },
    );
    this.broadcastState(c);
  }

  private studioTools(slug: string): StudioTool[] {
    const check = this.d.checkGame;
    if (!this.d.runner.hostsTools || !check) return [];
    // Errors the game already has, taken before the agent edits anything.
    const baseline = check(slug).then(
      (r) => new Set(r.errors.map(diagKey)),
      () => undefined,
    );
    return [
      {
        name: 'check_game',
        description: `Type- and syntax-check this game (games/${slug}/) against the engine contract in about a second. Reports only errors introduced since this prompt started. Call it after editing.`,
        input: {},
        run: async () => {
          const b = await baseline;
          return formatCheck(await check(slug, b), !!b);
        },
      },
    ];
  }

  stop(slug: string) {
    this.chats.get(slug)?.job?.handle.stop();
  }

  stopAll() {
    for (const c of this.chats.values()) c.job?.handle.stop();
  }

  reset(slug: string) {
    const c = this.chat(slug);
    if (c.job) throw new BusyError('busy');
    c.sessionId = null;
    c.log = [];
    this.push(slug, 'status', 'New conversation');
    this.broadcastState(c);
  }

  restore(slug: string, id: string) {
    if (this.isRunning(slug)) throw new BusyError('Wait for the current change to finish first');
    const { meta, engine } = this.d.checkpoints.restore(slug, id);
    this.d.onRestore(slug, engine);
    this.push(slug, 'status', `Restored the game to before "${meta.prompt}"`);
  }

  // Delete: refuses while a job runs, closes subscribers and forgets the in-memory chat.
  forget(slug: string) {
    if (this.isRunning(slug)) throw new BusyError('A change is still running on this project');
    const c = this.chats.get(slug);
    if (!c) return;
    if (c.saveTimer) clearTimeout(c.saveTimer);
    this.chats.delete(slug);
    for (const close of c.closers) close();
  }
}

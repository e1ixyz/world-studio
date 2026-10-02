// The per-project chat: its log, its agent job and the subscribers watching it. One job per
// project at a time. Every prompt is checkpointed first, and edits are limited to the game's
// folder (plus engine/ when allowed).
import type { ChatItem, ChatItemKind, ChatState } from '@ws/shared';
import { type AgentRunner, type AskPermission, type RunHandle, STUDIO_TOOL_PREFIX, type StudioTool } from './agent/runner.ts';
import { type CheckResult, diagKey, formatCheck } from './check-game.ts';
import type { ChatRepository } from './chat-store.ts';
import type { CheckpointStore } from './checkpoints/store.ts';
import type { LiveGames } from './live.ts';
import type { StudioEvents } from './events.ts';
import { gameDir, relPath, type StudioPaths } from './paths.ts';
import type { Projects } from './projects.ts';
import { systemPrompt } from './prompts.ts';
import type { SettingsStore } from './settings.ts';

export const MAX_LOG = 400;
export const PERMISSION_TIMEOUT_MS = 5 * 60_000;
export const BASE_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(npx vite build:*)'];

export type ChatEvent = ChatItem | ChatState;
type Listener = (e: ChatEvent) => void;

interface Job {
  handle: RunHandle;
  startedAt: number;
  engine: boolean;
  checkpoint: string;
  // open permission questions, by id
  asks: Map<string, (allow: boolean, state?: 'expired') => void>;
  // what the user explicitly declined (file paths or tool names), so the end-of-run "blocked" note skips it
  declined: Set<string>;
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
    case `${STUDIO_TOOL_PREFIX}view_game`:
      return 'Look at the game';
    case `${STUDIO_TOOL_PREFIX}game_state`:
      return 'Read the game state';
    case `${STUDIO_TOOL_PREFIX}reload_game`:
      return 'Reload the game and check it';
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
  // Questions for the open game window (view_game, game_state, reload_game).
  live?: LiveGames;
  // Apply this game's pending file changes now, even while a job runs (reload_game).
  reloadNow?(slug: string): void;
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
    const job: Job = { handle: { stop() {} }, startedAt: Date.now(), engine, checkpoint, asks: new Map(), declined: new Set() };
    c.job = job;
    job.handle = this.d.runner.start(
      {
        prompt,
        cwd: paths.root,
        allowedTools: tools,
        tools: studioTools,
        askPermission: this.permissionAsker(slug, job),
        appendSystemPrompt: systemPrompt(slug, meta, engine, {
          checkTool: studioTools.some((t) => t.name === 'check_game'),
          liveTools: studioTools.some((t) => t.name === 'view_game'),
        }),
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
          const denials = r.denials.filter((d) => !job.declined.has(d.tool_input?.file_path || d.tool_name));
          r = { ...r, denials };
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
          for (const answer of job.asks.values()) answer(false);
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

  // Ask the user in the chat. The card waits for an answer, the run stopping, or five minutes.
  private permissionAsker(slug: string, job: Job): AskPermission {
    return ({ tool, input, title }, signal) =>
      new Promise<boolean>((resolve) => {
        const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const target = typeof input.file_path === 'string' ? input.file_path : undefined;
        const text = title || (target ? `${tool} ${relPath(this.d.paths, target)}` : `${describeTool(this.d.paths, tool, input)}`);
        this.push(slug, 'permission', text, { id, tool, state: 'pending' });
        const finish = (allow: boolean, state?: 'expired') => {
          if (!job.asks.has(id)) return;
          job.asks.delete(id);
          clearTimeout(timer);
          if (!allow) job.declined.add(target || tool);
          this.push(slug, 'permission', '', { id, tool, state: state ?? (allow ? 'allowed' : 'denied') });
          resolve(allow);
        };
        const timer = setTimeout(() => finish(false, 'expired'), PERMISSION_TIMEOUT_MS);
        job.asks.set(id, finish);
        signal.addEventListener('abort', () => finish(false), { once: true });
      });
  }

  // The user's answer to a permission card. False if it was already answered or the run is over.
  answerPermission(slug: string, id: string, allow: boolean) {
    const answer = this.chats.get(slug)?.job?.asks.get(id);
    if (!answer) return false;
    answer(allow);
    return true;
  }

  private studioTools(slug: string): StudioTool[] {
    if (!this.d.runner.hostsTools) return [];
    return [...this.checkTools(slug), ...this.liveTools(slug)];
  }

  // view_game, game_state, reload_game: the agent looks at the running game through the studio window.
  private liveTools(slug: string): StudioTool[] {
    const live = this.d.live;
    if (!live) return [];
    const state = async () => JSON.stringify(await live.ask(slug, 'state'), null, 1);
    return [
      {
        name: 'view_game',
        description: 'See what the user sees in the game right now: a screenshot of the game view (the studio panels are not in it). Use it to check how a change looks.',
        input: {},
        run: async () => {
          const shot = (await live.ask(slug, 'screenshot', 8000)) as { data: string; width: number; height: number };
          const [, mimeType = 'image/jpeg', data = ''] = shot.data.match(/^data:([^;]+);base64,(.*)$/) || [];
          return [
            { type: 'image', data, mimeType },
            { type: 'text', text: `Screenshot of the game view, ${shot.width}x${shot.height}.` },
          ];
        },
      },
      {
        name: 'game_state',
        description:
          "The running game's state as JSON: mode, the player or build camera position, the build-mode selection, frame rate and renderer stats (draw calls, triangles), errors since the game loaded, and the game's own snapshot().",
        input: {},
        run: state,
      },
      {
        name: 'reload_game',
        description: "Apply this game's file changes in the user's window now (normally they apply when you finish), wait for it to start, and return its state and any errors. Use it to test a change before you finish.",
        input: {},
        run: async () => {
          this.d.reloadNow?.(slug);
          await new Promise((r) => setTimeout(r, 1500));
          return state();
        },
      },
    ];
  }

  private checkTools(slug: string): StudioTool[] {
    const check = this.d.checkGame;
    if (!check) return [];
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

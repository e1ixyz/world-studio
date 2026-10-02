// Where chat logs and run records live. The chat service keeps each project's recent log in
// memory and tells the repository about every change; repositories persist in order, in the
// background. DbChatRepository (PGlite / Postgres through @ws/db) is what the daemon uses.
// JsonChatRepository keeps the original .harness/projects/<slug>/chat.json files and is the
// fallback, and the source DbChatRepository imports from the first time it opens.
import path from 'node:path';
import { ChatFile, type ChatItem } from '@ws/shared';
import { readJSON, type StudioPaths, writeJSON } from './paths.ts';

export const MAX_LOG = 400; // items kept in memory and replayed to the panel

export interface ChatRepository {
  // The active conversation: its session, the highest seq ever used for the slug, and recent items.
  load(slug: string): ChatFile;
  append(slug: string, item: ChatItem): void;
  setSession(slug: string, sessionId: string | null): void;
  // "New conversation": the old one is kept (archived), the new one starts empty.
  reset(slug: string): void;
  // The project is going to the trash.
  remove(slug: string): void;
  flush(): Promise<void>;
}

export interface RunRecord {
  slug: string;
  prompt: string;
  runner: string;
  model?: string;
  engine: boolean;
  checkpointId?: string;
  startedAt: number;
}
export interface RunOutcome {
  ok?: boolean;
  subtype?: string;
  ms?: number;
  costUsd?: number;
  denials?: unknown[];
  error?: string;
  stopped?: boolean;
}
export interface RunRepository {
  start(run: RunRecord): Promise<string | null>;
  finish(id: Promise<string | null>, outcome: RunOutcome): void;
  recentRuns?(slug: string, limit?: number): Promise<unknown[]>;
}

export class JsonChatRepository implements ChatRepository, RunRepository {
  private p: StudioPaths;
  private cache = new Map<string, ChatFile>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(p: StudioPaths) {
    this.p = p;
  }
  private file(slug: string) {
    return path.join(this.p.data, 'projects', slug, 'chat.json');
  }
  load(slug: string): ChatFile {
    let c = this.cache.get(slug);
    if (!c) {
      const parsed = ChatFile.safeParse(readJSON(this.file(slug), {}));
      c = parsed.success ? parsed.data : { sessionId: null, seq: 0, log: [] };
      this.cache.set(slug, c);
    }
    return c;
  }
  private save(slug: string) {
    clearTimeout(this.timers.get(slug));
    this.timers.set(
      slug,
      setTimeout(() => {
        this.timers.delete(slug);
        const c = this.load(slug);
        writeJSON(this.file(slug), { sessionId: c.sessionId ?? null, seq: c.seq, log: c.log });
      }, 200),
    );
  }
  append(slug: string, item: ChatItem) {
    const c = this.load(slug);
    c.log.push(item);
    if (c.log.length > MAX_LOG) c.log.splice(0, c.log.length - MAX_LOG);
    c.seq = Math.max(c.seq, item.seq);
    this.save(slug);
  }
  setSession(slug: string, sessionId: string | null) {
    this.load(slug).sessionId = sessionId;
    this.save(slug);
  }
  reset(slug: string) {
    const c = this.load(slug);
    c.log = [];
    c.sessionId = null;
    this.save(slug);
  }
  // Projects.trash moves the chat folder; this only stops pending writes from recreating it.
  remove(slug: string) {
    clearTimeout(this.timers.get(slug));
    this.timers.delete(slug);
    this.cache.delete(slug);
  }
  async flush() {
    for (const [slug, t] of this.timers) {
      clearTimeout(t);
      const c = this.load(slug);
      writeJSON(this.file(slug), { sessionId: c.sessionId ?? null, seq: c.seq, log: c.log });
    }
    this.timers.clear();
  }
  // run records need the database
  async start() {
    return null;
  }
  finish() {}
}

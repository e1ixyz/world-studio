// Chat logs and run records in the studio database (@ws/db). The active conversations and their
// recent items are read once at startup; after that the chat service works from memory and every
// change is written in order, in the background.
import fs from 'node:fs';
import path from 'node:path';
import { chatItems, conversations, type Database, runs } from '@ws/db';
import { ChatFile, type ChatItem } from '@ws/shared';
import { and, desc, eq, isNull, max } from 'drizzle-orm';
import { type ChatRepository, MAX_LOG, type RunOutcome, type RunRecord, type RunRepository } from './chat-store.ts';
import { readJSON, type StudioPaths } from './paths.ts';

const WS = 'local';

interface Active {
  conversationId: string;
  file: ChatFile;
}

export class DbChatRepository implements ChatRepository, RunRepository {
  private db: Database;
  private active = new Map<string, Active>();
  private maxSeq = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  onError: (err: Error) => void = (err) => console.error('World Studio database write failed:', err);

  private constructor(db: Database) {
    this.db = db;
  }

  // Loads every active conversation. The first time, imports the old chat.json files.
  static async open(db: Database, p: StudioPaths) {
    const repo = new DbChatRepository(db);
    await repo.importJson(p);
    for (const row of await db.select({ slug: chatItems.slug, seq: max(chatItems.seq) }).from(chatItems).where(eq(chatItems.workspaceId, WS)).groupBy(chatItems.slug)) {
      repo.maxSeq.set(row.slug, row.seq ?? 0);
    }
    const open = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.workspaceId, WS), isNull(conversations.archivedAt)));
    for (const c of open) {
      const items = await db.select().from(chatItems).where(eq(chatItems.conversationId, c.id)).orderBy(desc(chatItems.seq)).limit(MAX_LOG);
      const log = items.reverse().map((i) => ({ seq: i.seq, kind: i.kind, text: i.text, meta: i.meta ?? undefined, ts: i.ts }));
      const parsed = ChatFile.safeParse({ sessionId: c.sessionId, seq: repo.maxSeq.get(c.slug) ?? 0, log });
      repo.active.set(c.slug, { conversationId: c.id, file: parsed.success ? parsed.data : { sessionId: c.sessionId, seq: repo.maxSeq.get(c.slug) ?? 0, log: [] } });
    }
    return repo;
  }

  // .harness/projects/<slug>/chat.json from before the database: imported once per project (a
  // project with any conversation row is never imported again). The files stay as a backup.
  private async importJson(p: StudioPaths) {
    const dir = path.join(p.data, 'projects');
    if (!fs.existsSync(dir)) return;
    const known = new Set((await this.db.selectDistinct({ slug: conversations.slug }).from(conversations)).map((r) => r.slug));
    for (const slug of fs.readdirSync(dir)) {
      if (known.has(slug)) continue;
      const parsed = ChatFile.safeParse(readJSON(path.join(dir, slug, 'chat.json'), null));
      if (!parsed.success) continue;
      const { sessionId, log } = parsed.data;
      await this.db.transaction(async (tx) => {
        const [c] = await tx.insert(conversations).values({ slug, sessionId: sessionId ?? null }).returning({ id: conversations.id });
        if (log.length) await tx.insert(chatItems).values(log.map((i) => ({ conversationId: c.id, slug, seq: i.seq, kind: i.kind, text: i.text, meta: i.meta ?? null, ts: i.ts })));
      });
    }
  }

  private write(fn: () => Promise<unknown>) {
    this.queue = this.queue.then(fn).catch((err) => this.onError(err));
  }

  private activeFor(slug: string): Active {
    let a = this.active.get(slug);
    if (!a) {
      const id = crypto.randomUUID();
      a = { conversationId: id, file: { sessionId: null, seq: this.maxSeq.get(slug) ?? 0, log: [] } };
      this.active.set(slug, a);
      this.write(() => this.db.insert(conversations).values({ id, slug }));
    }
    return a;
  }

  load(slug: string): ChatFile {
    const a = this.active.get(slug);
    if (a) return a.file;
    return { sessionId: null, seq: this.maxSeq.get(slug) ?? 0, log: [] };
  }

  append(slug: string, item: ChatItem) {
    const a = this.activeFor(slug);
    a.file.log.push(item);
    if (a.file.log.length > MAX_LOG) a.file.log.splice(0, a.file.log.length - MAX_LOG);
    a.file.seq = Math.max(a.file.seq, item.seq);
    this.maxSeq.set(slug, a.file.seq);
    const conversationId = a.conversationId;
    this.write(() => this.db.insert(chatItems).values({ conversationId, slug, seq: item.seq, kind: item.kind, text: item.text, meta: item.meta ?? null, ts: item.ts }));
  }

  setSession(slug: string, sessionId: string | null) {
    const a = this.activeFor(slug);
    a.file.sessionId = sessionId;
    const id = a.conversationId;
    this.write(() => this.db.update(conversations).set({ sessionId }).where(eq(conversations.id, id)));
  }

  private archive(slug: string) {
    const a = this.active.get(slug);
    if (!a) return;
    this.active.delete(slug);
    const id = a.conversationId;
    this.write(() => this.db.update(conversations).set({ archivedAt: new Date() }).where(eq(conversations.id, id)));
  }

  reset(slug: string) {
    this.archive(slug);
  }

  // The history stays in the database (archived); a new project with the same slug starts empty.
  remove(slug: string) {
    this.archive(slug);
  }

  flush() {
    return this.queue.then(() => undefined);
  }

  // ---------- runs ----------
  async start(run: RunRecord) {
    const conversationId = this.active.get(run.slug)?.conversationId ?? null;
    await this.flush(); // the conversation row may still be queued
    const [r] = await this.db
      .insert(runs)
      .values({ ...run, conversationId, startedAt: new Date(run.startedAt) })
      .returning({ id: runs.id });
    return r.id;
  }

  finish(id: Promise<string | null>, o: RunOutcome) {
    this.write(async () => {
      const runId = await id;
      if (!runId) return;
      await this.db
        .update(runs)
        .set({ endedAt: new Date(), ok: o.ok, subtype: o.subtype, ms: o.ms, costUsd: o.costUsd, denials: o.denials ?? null, error: o.error, stopped: !!o.stopped })
        .where(eq(runs.id, runId));
    });
  }

  async recentRuns(slug: string, limit = 20) {
    await this.flush();
    return this.db.select().from(runs).where(and(eq(runs.workspaceId, WS), eq(runs.slug, slug))).orderBy(desc(runs.startedAt)).limit(limit);
  }
}

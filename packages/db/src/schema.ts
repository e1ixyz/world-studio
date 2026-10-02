// The studio's database. Postgres dialect: PGlite (Postgres compiled to WASM, a folder on disk)
// for the local daemon, and the same schema and migrations for a hosted Postgres later. Every row
// carries workspace_id ('local' on one machine) so a multi-user deployment can partition by it.
//
// Game code and game.json stay files in games/<slug>/; the agent edits those. The database holds
// what the harness itself produces: conversations, their chat items, and runs.
import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const workspace = () => text('workspace_id').notNull().default('local');

// One per "New conversation". The active one for a project has archived_at = null.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: workspace(),
    slug: text('slug').notNull(),
    sessionId: text('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('conversations_slug_idx').on(t.workspaceId, t.slug, t.archivedAt)],
);

// The chat log, as the panel shows it (packages/shared ChatItem). seq is per project and only grows.
export const chatItems = pgTable(
  'chat_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: workspace(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    meta: jsonb('meta'),
    ts: bigint('ts', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('chat_items_slug_seq_idx').on(t.workspaceId, t.slug, t.seq)],
);

// One agent run per prompt: what it cost, how long it took, what it was refused.
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: workspace(),
    slug: text('slug').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    checkpointId: text('checkpoint_id'),
    prompt: text('prompt').notNull(),
    runner: text('runner').notNull(),
    model: text('model'),
    engine: boolean('engine').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ok: boolean('ok'),
    subtype: text('subtype'),
    ms: integer('ms'),
    costUsd: doublePrecision('cost_usd'),
    denials: jsonb('denials'),
    error: text('error'),
    stopped: boolean('stopped').notNull().default(false),
  },
  (t) => [index('runs_slug_idx').on(t.workspaceId, t.slug, t.startedAt)],
);

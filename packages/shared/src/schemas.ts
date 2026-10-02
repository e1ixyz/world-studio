// Wire and storage shapes shared by the studio server, the studio UI and the game bridge.
// These match what the harness already writes (.harness/projects/<slug>/chat.json and friends),
// so existing data stays valid. Extend them; don't rename fields.
import { z } from 'zod';

export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}$/);

const itemBase = { seq: z.number().int(), text: z.string(), ts: z.number() };

export const ChatItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), ...itemBase, meta: z.object({ engine: z.boolean().optional() }).optional() }),
  z.object({ kind: z.literal('text'), ...itemBase, meta: z.unknown().optional() }),
  z.object({ kind: z.literal('tool'), ...itemBase, meta: z.object({ name: z.string() }).optional() }),
  z.object({ kind: z.literal('status'), ...itemBase, meta: z.unknown().optional() }),
  z.object({ kind: z.literal('error'), ...itemBase, meta: z.unknown().optional() }),
  z.object({ kind: z.literal('reload'), ...itemBase, meta: z.object({ files: z.array(z.string()) }).optional() }),
  z.object({
    kind: z.literal('done'),
    ...itemBase,
    meta: z.object({ ms: z.number().optional(), cost: z.number().optional() }).optional(),
  }),
]);
export type ChatItem = z.infer<typeof ChatItem>;
export type ChatItemKind = ChatItem['kind'];

// Sent on the chat event stream after the replay and whenever a job starts or ends.
export const ChatState = z.object({
  kind: z.literal('state'),
  running: z.boolean(),
  startedAt: z.number().optional(),
  engine: z.boolean(),
  session: z.boolean(),
  seq: z.number().int(),
});
export type ChatState = z.infer<typeof ChatState>;

export const ChatFile = z.object({
  sessionId: z.string().nullable().optional(),
  seq: z.number().int().default(0),
  log: z.array(ChatItem).default([]),
});
export type ChatFile = z.infer<typeof ChatFile>;

export const GameMeta = z.object({
  name: z.string().optional(),
  template: z.string().optional(),
  description: z.string().optional(),
  created: z.number().optional(),
  updated: z.number().optional(),
});
export type GameMeta = z.infer<typeof GameMeta>;

export const Project = z.object({
  slug: Slug,
  name: z.string(),
  template: z.string(),
  description: z.string(),
  created: z.number(),
  updated: z.number(),
  thumb: z.string().nullable(),
  running: z.boolean(),
});
export type Project = z.infer<typeof Project>;

export const Template = GameMeta.extend({ id: z.string() });
export type Template = z.infer<typeof Template>;

export const CheckpointMeta = z.object({
  id: z.string(),
  prompt: z.string(),
  time: z.number(),
  engine: z.boolean(),
});
export type CheckpointMeta = z.infer<typeof CheckpointMeta>;

export const Settings = z.object({ alwaysEngine: z.boolean().default(false) });
export type Settings = z.infer<typeof Settings>;

// ---- request bodies ----
export const CreateProjectBody = z.object({
  name: z.string().optional(),
  template: z.string(),
  description: z.string().optional(),
});
export const RenameBody = z.object({ name: z.string().optional() });
export const DuplicateBody = z.object({ name: z.string().optional() });
export const PromptBody = z.object({
  text: z.string(),
  display: z.string().optional(),
  engine: z.boolean().optional(),
});
export const RestoreBody = z.object({ id: z.string() });
export const SettingsBody = z.object({ alwaysEngine: z.boolean().optional() });
export const ImageBody = z.object({ slug: Slug, data: z.string() });
export const TweaksBody = z.object({ slug: Slug, values: z.record(z.string(), z.unknown()).default({}) });

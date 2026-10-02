// Wire and storage shapes shared by the studio server, the studio UI and the game bridge.
// These match what the harness already writes (.harness/projects/<slug>/chat.json and friends),
// so existing data stays valid. Extend them; don't rename fields.
import { DEFAULT_THEME, THEME_IDS } from '@ws/theme';
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
  // The agent asked to do something the harness doesn't allow on its own. The first item is the
  // request (state 'pending'); a later item with the same id records the answer.
  z.object({
    kind: z.literal('permission'),
    ...itemBase,
    meta: z.object({ id: z.string(), tool: z.string().optional(), state: z.enum(['pending', 'allowed', 'denied', 'expired']) }),
  }),
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
  // What the prompt changed, when known (git checkpoints, once the run has finished).
  files: z.number().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  // Folder-copy checkpoint from before git checkpoints.
  legacy: z.boolean().optional(),
});

export const CheckpointDiff = z.object({
  id: z.string(),
  files: z.array(z.object({ path: z.string(), additions: z.number(), deletions: z.number() })),
  patch: z.string(),
});
export type CheckpointDiff = z.infer<typeof CheckpointDiff>;
export type CheckpointMeta = z.infer<typeof CheckpointMeta>;

export const ThemeId = z.enum(THEME_IDS);
// An unknown theme in settings.json (hand-edited, or from a newer studio) falls back to the default.
export const Settings = z.object({
  alwaysEngine: z.boolean().default(false),
  theme: ThemeId.catch(DEFAULT_THEME).default(DEFAULT_THEME),
});
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
export const PermissionBody = z.object({ allow: z.boolean() });
export const ProbeResultBody = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() });
export const SettingsBody = z.object({ alwaysEngine: z.boolean().optional(), theme: ThemeId.optional() });
export const ImageBody = z.object({ slug: Slug, data: z.string() });
export const TweaksBody = z.object({ slug: Slug, values: z.record(z.string(), z.unknown()).default({}) });

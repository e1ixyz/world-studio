// The studio shell and the game it frames talk only through these postMessage messages. Both
// sides validate what they receive, and nothing reaches into the other window directly, so the
// game page could later be served from a separate (sandboxed) origin without changing either side.
import { z } from 'zod';

export const BRIDGE = 'world-studio';
export const BRIDGE_VERSION = 1;

const envelope = { bridge: z.literal(BRIDGE), v: z.literal(BRIDGE_VERSION) };
const Mode = z.enum(['menu', 'play', 'build', 'paused', 'map']).or(z.string());

// Build mode's state, for the studio's panels (engine/build/buildmode.js state()).
export const TweakView = z.object({
  key: z.string(),
  name: z.string(),
  group: z.string(),
  engine: z.boolean(),
  type: z.enum(['range', 'color', 'bool', 'select']),
  value: z.unknown(),
  initial: z.unknown(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).nullable(),
  save: z.boolean(),
});
export type TweakView = z.infer<typeof TweakView>;
export const SelectionView = z.object({
  kind: z.string(),
  id: z.union([z.string(), z.number()]).nullable(),
  props: z.record(z.string(), z.unknown()),
  source: z.string().nullable(),
  center: z.tuple([z.number(), z.number(), z.number()]),
  size: z.tuple([z.number(), z.number(), z.number()]),
});
export type SelectionView = z.infer<typeof SelectionView>;
export const BuildState = z.object({
  active: z.boolean(),
  frozen: z.boolean(),
  time: z.number(),
  night: z.number(),
  moved: z.boolean(),
  selection: SelectionView.nullable(),
  tweaks: z.array(TweakView),
  unsaved: z.number(),
  values: z.record(z.string(), z.unknown()),
});
export type BuildState = z.infer<typeof BuildState>;

// game -> studio
export const GameMessage = z.discriminatedUnion('t', [
  z.object({ ...envelope, t: z.literal('ready'), slug: z.string(), title: z.string().optional() }),
  // sent whenever the mode or the build-mode selection changes
  z.object({ ...envelope, t: z.literal('state'), mode: Mode.nullable(), selection: z.string(), canShoot: z.boolean() }),
  z.object({ ...envelope, t: z.literal('open'), focus: z.boolean() }),
  z.object({ ...envelope, t: z.literal('close') }),
  z.object({ ...envelope, t: z.literal('toggle') }),
  z.object({ ...envelope, t: z.literal('focusComposer') }),
  z.object({ ...envelope, t: z.literal('shot'), path: z.string(), thumb: z.string() }),
  z.object({ ...envelope, t: z.literal('error'), text: z.string() }),
  z.object({ ...envelope, t: z.literal('quickPrompt'), text: z.string() }),
  z.object({ ...envelope, t: z.literal('context'), id: z.number(), text: z.string() }),
  z.object({ ...envelope, t: z.literal('probeResult'), id: z.string(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() }),
  z.object({ ...envelope, t: z.literal('build'), state: BuildState }),
]);
export type GameMessage = z.infer<typeof GameMessage>;

// studio -> game
export const StudioMessage = z.discriminatedUnion('t', [
  z.object({ ...envelope, t: z.literal('panel'), open: z.boolean() }),
  // the studio's text box has focus: the game drops held keys and doesn't pause on losing pointer lock
  z.object({ ...envelope, t: z.literal('typing'), on: z.boolean() }),
  z.object({ ...envelope, t: z.literal('requestContext'), id: z.number() }),
  z.object({ ...envelope, t: z.literal('screenshot') }),
  z.object({ ...envelope, t: z.literal('exitPointerLock') }),
  // a question from the agent: 'screenshot' (the view as a JPEG data URL) or 'state' (JSON)
  z.object({ ...envelope, t: z.literal('probe'), id: z.string(), what: z.enum(['screenshot', 'state']) }),
  // build mode, from the studio's panels
  z.object({
    ...envelope,
    t: z.literal('buildAction'),
    a: z.enum(['play', 'toggleFreeze', 'setTime', 'playFromHere', 'frame', 'deselect', 'tweakSet', 'tweakReset', 'tweakDiscard', 'tweakSaved']),
    key: z.string().optional(),
    value: z.unknown().optional(),
  }),
]);
export type StudioMessage = z.infer<typeof StudioMessage>;

type Body<M> = M extends unknown ? Omit<M, 'bridge' | 'v'> : never;
export type GameMessageBody = Body<GameMessage>;
export type StudioMessageBody = Body<StudioMessage>;

export function send<M extends GameMessageBody | StudioMessageBody>(target: Window | null | undefined, msg: M, origin: string) {
  target?.postMessage({ bridge: BRIDGE, v: BRIDGE_VERSION, ...msg }, origin);
}

// Listen for messages of one schema from one window and origin. Returns a function that stops listening.
export function listen<S extends z.ZodType>(from: () => Window | null | undefined, origin: string, schema: S, handler: (m: z.infer<S>) => void) {
  const onMessage = (e: MessageEvent) => {
    if (e.source !== from() || e.origin !== origin) return;
    if ((e.data as { bridge?: string })?.bridge !== BRIDGE) return;
    const parsed = schema.safeParse(e.data);
    if (parsed.success) handler(parsed.data);
    else console.warn('World Studio bridge: dropped a malformed message', e.data, parsed.error.issues);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

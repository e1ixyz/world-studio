// Turns the chat log into what the panel shows. Each turn's tool calls collapse into one
// "N steps" group, a text after tools starts a new group, and when the turn ends every text but
// the last becomes a dimmed progress note. Pure, so it is unit tested.
import type { ChatItem } from '@ws/shared';

// Errors the studio adds itself (from the game) carry no seq and can be fixed with one click.
export type LocalError = { kind: 'error'; text: string; fixable: true; localId: number; ts: number };
export type LogItem = ChatItem | LocalError;

export type Block =
  | { k: 'user'; key: string; text: string; extra?: string }
  | { k: 'steps'; key: string; steps: string[] }
  | { k: 'text'; key: string; text: string; progress: boolean }
  | { k: 'note'; key: string; text: string }
  | { k: 'reload'; key: string; text: string }
  | { k: 'error'; key: string; text: string; fixable: boolean };

export const secs = (ms: number) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

const keyOf = (item: LogItem) => ('localId' in item ? `local-${item.localId}` : `s${item.seq}`);

export function buildTimeline(items: LogItem[]): Block[] {
  const blocks: Block[] = [];
  let turn: { texts: number[]; steps: number | null; start: number } | null = null;
  const startTurn = (ts: number) => ({ texts: [], steps: null, start: ts || Date.now() });
  for (const item of items) {
    const key = keyOf(item);
    switch (item.kind) {
      case 'user': {
        const [text, extra] = String(item.text).split(/\n(?=\[with )/);
        blocks.push({ k: 'user', key, text, extra: extra?.slice(1, -1) });
        turn = startTurn(item.ts);
        break;
      }
      case 'tool': {
        turn ??= startTurn(item.ts);
        if (turn.steps === null) {
          turn.steps = blocks.length;
          blocks.push({ k: 'steps', key, steps: [] });
        }
        (blocks[turn.steps] as Extract<Block, { k: 'steps' }>).steps.push(item.text);
        break;
      }
      case 'text':
        if (turn) {
          turn.texts.push(blocks.length);
          turn.steps = null; // the next tool starts a new group
        }
        blocks.push({ k: 'text', key, text: item.text, progress: false });
        break;
      case 'done': {
        // earlier messages in the turn were progress notes; the last one is the answer
        if (turn) for (const i of turn.texts.slice(0, -1)) (blocks[i] as Extract<Block, { k: 'text' }>).progress = true;
        const ms = item.meta?.ms || (turn ? (item.ts || Date.now()) - turn.start : 0);
        blocks.push({ k: 'note', key, text: `Done${ms ? ` in ${secs(ms)}` : ''}` });
        turn = null;
        break;
      }
      case 'reload':
        blocks.push({ k: 'reload', key, text: item.text });
        break;
      case 'status':
        blocks.push({ k: 'note', key, text: item.text });
        break;
      case 'error':
        blocks.push({ k: 'error', key, text: item.text, fixable: 'fixable' in item && item.fixable });
        break;
    }
  }
  return blocks;
}

// What the status pill says for a new live item, if anything.
export function feedFor(item: LogItem): { text: string; error?: boolean } | null {
  switch (item.kind) {
    case 'user':
      return { text: `Sent: ${item.text.split('\n')[0]}` };
    case 'tool':
      return { text: item.text };
    case 'text':
      return { text: item.text.split('\n')[0] };
    case 'reload':
      return { text: 'Applying changes…' };
    case 'error':
      return { text: 'Something went wrong. Press ` to see it', error: true };
    default:
      return null;
  }
}

// The selected object's name, from the "[Selected object: …]" block.
export const selectionName = (sel: string) => sel.match(/^\[Selected object: ([^.]*?) centered/)?.[1] || 'object';
export const selectionKind = (sel: string) => sel.match(/^\[Selected object: (\w[\w ]*?)[ "]/)?.[1];

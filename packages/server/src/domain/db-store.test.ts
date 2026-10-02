import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '@ws/db';
import type { ChatItem } from '@ws/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChatRepository } from './db-store.ts';
import { studioPaths } from './paths.ts';

let root: string;
let closeDb: () => Promise<void>;
const item = (seq: number, kind: ChatItem['kind'] = 'text', text = `item ${seq}`) => ({ seq, kind, text, ts: seq * 1000 }) as ChatItem;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-db-'));
});
afterEach(async () => {
  await closeDb?.();
  fs.rmSync(root, { recursive: true, force: true });
});

async function open(dataDir?: string) {
  const { db, close } = await openDatabase(dataDir ? { dataDir } : { memory: true });
  closeDb = close;
  return { db, repo: await DbChatRepository.open(db, studioPaths(root)) };
}

describe('DbChatRepository', () => {
  it('imports old chat.json files once and keeps them', async () => {
    const file = path.join(root, '.harness/projects/g/chat.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ sessionId: 'sess-1', seq: 2, log: [item(1, 'user', 'hi'), item(2)] }));
    const { repo } = await open();
    expect(repo.load('g')).toMatchObject({ sessionId: 'sess-1', seq: 2, log: [{ seq: 1, kind: 'user', text: 'hi' }, { seq: 2 }] });
    expect(fs.existsSync(file)).toBe(true);
  });

  it('persists appends, sessions and resets across a reopen, and seq keeps growing', async () => {
    const dir = path.join(root, 'db');
    let { repo } = await open(dir);
    repo.append('g', item(1, 'user'));
    repo.setSession('g', 's1');
    repo.append('g', item(2));
    await repo.flush();
    await closeDb();

    ({ repo } = await open(dir));
    expect(repo.load('g')).toMatchObject({ sessionId: 's1', seq: 2 });
    expect(repo.load('g').log.map((i) => i.seq)).toEqual([1, 2]);

    repo.reset('g'); // new conversation: old one archived
    expect(repo.load('g')).toMatchObject({ sessionId: null, seq: 2, log: [] });
    repo.append('g', item(3, 'status', 'New conversation'));
    await repo.flush();
    await closeDb();

    ({ repo } = await open(dir));
    expect(repo.load('g').log.map((i) => i.text)).toEqual(['New conversation']);

    // a deleted project's history stays archived; a new project with the slug starts clean
    repo.remove('g');
    expect(repo.load('g')).toMatchObject({ log: [], seq: 3 });
    repo.append('g', item(4));
    await repo.flush();
  });

  it('records runs', async () => {
    const { repo } = await open();
    repo.append('g', item(1, 'user'));
    const id = repo.start({ slug: 'g', prompt: 'make it rain', runner: 'fake', engine: false, checkpointId: 'abc', startedAt: Date.now() });
    repo.finish(id, { ok: true, subtype: 'success', ms: 1200, costUsd: 0.12, denials: [] });
    const [run] = await repo.recentRuns('g');
    expect(run).toMatchObject({ prompt: 'make it rain', runner: 'fake', ok: true, ms: 1200, costUsd: 0.12, checkpointId: 'abc' });
    expect(run.conversationId).toBeTruthy();
    expect(run.endedAt).toBeInstanceOf(Date);
  });
});

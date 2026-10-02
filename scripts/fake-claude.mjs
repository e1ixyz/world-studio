#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: DEVCHAT_CLAUDE=scripts/fake-claude.mjs.
// Speaks the same stream-json the harness parses and makes a real edit, so checkpoints,
// reloads and the chat UI can be exercised without a model, a login or a bill.
// Markers in the prompt: [slow] waits 3 s before editing, [deny] reports an engine edit denial,
// [fail] ends with an error result, [noedit] skips the edit.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] || '';
const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
const session = resume || `fake-${Date.now().toString(36)}`;
const editRule = args.find((a) => /^Edit\(\/\/.*\/games\/[^/]+\/\*\*\)$/.test(a)) || '';
const gameDir = editRule.slice('Edit(/'.length, -'/**)'.length);
const out = (msg) => process.stdout.write(`${JSON.stringify({ session_id: session, ...msg })}\n`);
const started = Date.now();

out({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Read', 'Edit'] });
if (prompt.includes('[slow]')) await new Promise((r) => setTimeout(r, 3000));

const file = path.join(gameDir, 'game.js');
out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: file } }] } });
if (!prompt.includes('[noedit]') && gameDir && fs.existsSync(file)) {
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: file } }] } });
  fs.appendFileSync(file, `// fake-agent: ${prompt.split('\n').at(-1).slice(0, 60).replace(/\*\//g, '')}\n`);
}
const denials = prompt.includes('[deny]')
  ? [{ tool_name: 'Edit', tool_use_id: 't3', tool_input: { file_path: path.join(process.cwd(), 'engine/core/app.js') } }]
  : [];
const failed = prompt.includes('[fail]');
out({ type: 'assistant', message: { content: [{ type: 'text', text: failed ? 'Something went wrong.' : 'Done: added a comment to game.js.' }] } });
out({
  type: 'result',
  subtype: failed ? 'error_during_execution' : 'success',
  is_error: failed,
  result: failed ? 'Fake failure' : 'ok',
  duration_ms: Date.now() - started,
  total_cost_usd: 0,
  permission_denials: denials,
});

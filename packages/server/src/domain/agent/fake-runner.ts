// A stand-in agent for tests (DEVCHAT_RUNNER=fake): no model, no login, no bill. It behaves like a
// tiny scripted Claude: reads game.js, appends a comment to it, and reports a result. Markers in
// the prompt pick other paths:
//   [slow]    wait 3 s first          [noedit]  don't edit
//   [deny]    report an engine edit the harness denied
//   [fail]    end with an error result
//   [view]    call view_game and game_state and describe what came back
//   [ask]     ask permission to edit an engine file; edit game.js only if allowed
//   [reload]  call reload_game after editing
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRunner, RunEvents, RunRequest, ToolContent } from './runner.ts';

export class FakeRunner implements AgentRunner {
  readonly name = 'fake';
  readonly hostsTools = true;

  start(req: RunRequest, on: RunEvents) {
    const abort = new AbortController();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const has = (m: string) => req.prompt.includes(`[${m}]`);
    const tool = (name: string) => req.tools?.find((t) => t.name === name);
    const editRule = req.allowedTools.find((a) => /^Edit\(\/\/.*\/games\/[^/]+\/\*\*\)$/.test(a)) || '';
    const gameDir = editRule.slice('Edit(/'.length, -'/**)'.length);
    const file = path.join(gameDir, 'game.js');
    const started = Date.now();

    (async () => {
      on.session(req.resume || `fake-${started.toString(36)}`);
      if (has('slow')) await sleep(3000);
      if (abort.signal.aborted) return on.exit({ stopped: true });
      on.tool('Read', { file_path: file });
      let edit = !has('noedit');
      if (has('ask')) {
        const target = path.join(req.cwd, 'engine/core/fake-ask.js');
        on.tool('Edit', { file_path: target });
        const allowed = (await req.askPermission?.({ tool: 'Edit', input: { file_path: target } }, abort.signal)) ?? false;
        if (abort.signal.aborted) return on.exit({ stopped: true });
        on.text(allowed ? 'Allowed; editing the game instead of the engine for this test.' : 'Not allowed, so I left the engine alone.');
        edit = edit && allowed;
      }
      if (edit && gameDir && fs.existsSync(file)) {
        on.tool('Edit', { file_path: file });
        fs.appendFileSync(file, `// fake-agent: ${req.prompt.split('\n').at(-1)?.slice(0, 60).replace(/\*\//g, '')}\n`);
      }
      if (has('reload')) {
        on.tool('mcp__studio__reload_game', {});
        const out = await tool('reload_game')?.run({});
        on.text(`reload_game said: ${typeof out === 'string' ? out.slice(0, 300) : 'image'}`);
      }
      if (has('view')) {
        for (const name of ['view_game', 'game_state']) {
          on.tool(`mcp__studio__${name}`, {});
          try {
            const out = (await tool(name)?.run({})) ?? '';
            const parts: ToolContent[] = typeof out === 'string' ? [{ type: 'text', text: out }] : out;
            const image = parts.find((p) => p.type === 'image');
            const text = parts.find((p) => p.type === 'text')?.text ?? '';
            on.text(image ? `${name}: got a ${image.mimeType} image, ${image.data.length} base64 chars. ${text}` : `${name}: ${text.slice(0, 400)}`);
          } catch (err) {
            on.text(`${name} failed: ${(err as Error).message}`);
          }
        }
      }
      const failed = has('fail');
      on.text(failed ? 'Something went wrong.' : 'Done: added a comment to game.js.');
      on.result({
        ok: !failed,
        subtype: failed ? 'error_during_execution' : 'success',
        text: failed ? 'Fake failure' : 'ok',
        ms: Date.now() - started,
        cost: 0,
        denials: has('deny') ? [{ tool_name: 'Edit', tool_input: { file_path: path.join(req.cwd, 'engine/core/app.js') } }] : [],
      });
      on.exit({ stopped: false });
    })().catch((err) => on.exit({ stopped: false, error: String(err?.message || err) }));

    return { stop: () => abort.abort() };
  }
}

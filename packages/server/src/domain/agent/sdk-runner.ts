// Runs Claude Code through the Agent SDK, using the `claude` binary on PATH so the run uses the
// user's own login and version, exactly like the CLI runner. All settings sources load (the SDK
// default), so the user's hooks and permissions apply as they do in the terminal. On top of the
// CLI it hosts studio tools in-process (check_game) and stops cleanly through an AbortController.
import { execFileSync } from 'node:child_process';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner, RunEvents, RunRequest } from './runner.ts';

export function resolveClaude(bin = process.env.DEVCHAT_CLAUDE || 'claude') {
  if (bin.includes('/')) return bin;
  try {
    return execFileSync('/usr/bin/which', [bin], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export class SdkRunner implements AgentRunner {
  readonly hostsTools = true;

  start(req: RunRequest, on: RunEvents) {
    const abort = new AbortController();
    let stopped = false;
    const executable = resolveClaude();
    const mcpServers = req.tools?.length
      ? {
          studio: createSdkMcpServer({
            name: 'studio',
            tools: req.tools.map((t) =>
              tool(t.name, t.description, t.input, async (args) => {
                try {
                  const out = await t.run(args as Record<string, unknown>);
                  return { content: typeof out === 'string' ? [{ type: 'text' as const, text: out }] : out };
                } catch (err) {
                  return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
                }
              }),
            ),
          }),
        }
      : undefined;

    (async () => {
      let gotResult = false;
      let error: string | undefined;
      try {
        if (!executable) throw new Error('Couldn’t find the `claude` command-line tool. Install it and log in, or set DEVCHAT_CLAUDE to its path.');
        const q = query({
          prompt: req.prompt,
          options: {
            cwd: req.cwd,
            allowedTools: req.allowedTools,
            permissionMode: 'default',
            systemPrompt: { type: 'preset', preset: 'claude_code', append: req.appendSystemPrompt },
            resume: req.resume || undefined,
            model: req.model,
            env: { ...process.env, ...req.env },
            pathToClaudeCodeExecutable: executable,
            abortController: abort,
            mcpServers,
            canUseTool: req.askPermission
              ? async (toolName, input, opts) => {
                  const allow = await req.askPermission?.({ tool: toolName, input, title: opts.title, toolUseID: opts.toolUseID }, opts.signal);
                  return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this in World Studio.' };
                }
              : undefined,
          },
        });
        for await (const msg of q) {
          if ('session_id' in msg && msg.session_id) on.session(msg.session_id);
          if (msg.type === 'assistant') {
            for (const b of msg.message.content) {
              if (b.type === 'text' && b.text.trim()) on.text(b.text.trim());
              if (b.type === 'tool_use') on.tool(b.name, (b.input as Record<string, unknown>) || {});
            }
          } else if (msg.type === 'result') {
            gotResult = true;
            on.result({
              ok: !msg.is_error && msg.subtype === 'success',
              subtype: msg.subtype,
              text: 'result' in msg ? msg.result : undefined,
              ms: msg.duration_ms,
              cost: msg.total_cost_usd,
              denials: (msg.permission_denials || []) as never,
            });
          }
        }
      } catch (err) {
        if (!stopped) error = (err as Error).message || String(err);
      }
      if (!stopped && !error && !gotResult) error = 'The agent ended without a result';
      on.exit({ stopped, error });
    })();

    return {
      stop() {
        stopped = true;
        abort.abort();
      },
    };
  }
}

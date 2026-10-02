// Runs the `claude` CLI headless with stream-json output. DEVCHAT_CLAUDE picks another binary
// (tests use scripts/fake-claude.mjs).
import { spawn } from 'node:child_process';
import type { AgentRunner, RunEvents, RunRequest } from './runner.ts';

export class CliRunner implements AgentRunner {
  readonly hostsTools = false;
  private bin: string;
  constructor(bin = process.env.DEVCHAT_CLAUDE || 'claude') {
    this.bin = bin;
  }

  start(req: RunRequest, on: RunEvents) {
    const args = ['-p', req.prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', ...req.allowedTools, '--append-system-prompt', req.appendSystemPrompt];
    if (req.resume) args.push('--resume', req.resume);
    if (req.model) args.push('--model', req.model);
    const child = spawn(this.bin, args, { cwd: req.cwd, env: { ...process.env, ...req.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let gotResult = false;
    let stderr = '';
    let failed: string | undefined;
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: line splitter
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.session_id) on.session(msg.session_id);
        if (msg.type === 'assistant') {
          for (const b of msg.message?.content || []) {
            if (b.type === 'text' && b.text.trim()) on.text(b.text.trim());
            if (b.type === 'tool_use') on.tool(b.name, b.input || {});
          }
        } else if (msg.type === 'result') {
          gotResult = true;
          on.result({
            ok: !msg.is_error && msg.subtype === 'success',
            subtype: msg.subtype,
            text: msg.result,
            ms: msg.duration_ms,
            cost: msg.total_cost_usd,
            denials: msg.permission_denials || [],
          });
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      failed =
        err.code === 'ENOENT'
          ? 'Couldn’t find the `claude` command-line tool. Install it and log in, or set DEVCHAT_CLAUDE to its path.'
          : `Failed to start: ${err.message}`;
    });
    child.on('close', (code, signal) => {
      if (signal) return on.exit({ stopped: true });
      if (failed) return on.exit({ stopped: false, error: failed });
      if (code !== 0 && !gotResult) return on.exit({ stopped: false, error: stderr.trim().split('\n').slice(-6).join('\n') || `Exited with code ${code}` });
      on.exit({ stopped: false });
    });
    return { stop: () => child.kill('SIGTERM') };
  }
}

// How the harness runs a coding agent on one prompt. SdkRunner drives Claude Code through the
// Agent SDK (the default); CliRunner spawns the `claude` CLI with stream-json output.
import type { z } from 'zod';

export interface PermissionDenial {
  tool_name: string;
  tool_input?: { file_path?: string; [k: string]: unknown };
}

export interface RunResult {
  ok: boolean;
  subtype: string;
  text?: string;
  ms?: number;
  cost?: number;
  denials: PermissionDenial[];
}

// A tool the studio offers the agent in-process (exposed as mcp__studio__<name>). Runners that
// can't host tools (the CLI) leave them out.
export interface StudioTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run(args: Record<string, unknown>): Promise<string>;
}

export const STUDIO_TOOL_PREFIX = 'mcp__studio__';

export interface RunRequest {
  prompt: string;
  cwd: string;
  allowedTools: string[];
  tools?: StudioTool[];
  appendSystemPrompt: string;
  resume?: string | null;
  model?: string;
  env?: Record<string, string | undefined>;
}

export interface RunEvents {
  session(id: string): void;
  text(text: string): void;
  tool(name: string, input: Record<string, unknown>): void;
  result(r: RunResult): void;
  // Always called once. `error` is set when the run failed without a result.
  exit(info: { stopped: boolean; error?: string }): void;
}

export interface RunHandle {
  stop(): void;
}

export interface AgentRunner {
  // Whether `tools` reach the agent.
  readonly hostsTools: boolean;
  start(req: RunRequest, on: RunEvents): RunHandle;
}

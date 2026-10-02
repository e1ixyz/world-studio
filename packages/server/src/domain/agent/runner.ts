// How the harness runs a coding agent on one prompt. CliRunner spawns the `claude` CLI; later
// runners (the Agent SDK) implement the same interface.

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

export interface RunRequest {
  prompt: string;
  cwd: string;
  allowedTools: string[];
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
  start(req: RunRequest, on: RunEvents): RunHandle;
}

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { ChatEvent, RunConfig, RunMode } from "@shared/chat";
import type { ProviderRuntimeConfig } from "@shared/providers";

export type CodexRunOptions = {
  prompt: string;
  cwd?: string;
  resumeSessionId?: string | null;
  runConfig: RunConfig;
  runtime?: ProviderRuntimeConfig;
  signal: AbortSignal;
  onEvent: (event: ChatEvent) => void;
};

type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | {
      type: "item.started" | "item.completed";
      item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string;
        aggregated_output?: string;
        exit_code?: number | null;
        status?: string;
      };
    }
  | {
      type: "turn.completed";
      usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
      };
    }
  | { type: "error"; message?: string };

export async function runCodex({
  prompt,
  cwd,
  resumeSessionId,
  runConfig,
  runtime,
  signal,
  onEvent,
}: CodexRunOptions): Promise<void> {
  const startedAt = Date.now();
  const child = spawnCodex(prompt, cwd, resumeSessionId, runConfig, runtime);
  let stderr = "";
  let sawResult = false;
  const toolIds = new Set<string>();

  const abort = () => {
    if (!child.killed) child.kill();
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseJsonLine(line);
      if (event) dispatchCodexEvent(event, onEvent, toolIds, startedAt, runConfig.model, () => {
        sawResult = true;
      });
    }
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolve) => {
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        resolve();
        return;
      }
      const event = parseJsonLine(stdoutBuffer);
      if (event) {
        dispatchCodexEvent(event, onEvent, toolIds, startedAt, runConfig.model, () => {
          sawResult = true;
        });
      }
      if (code !== 0) {
        onEvent({
          kind: "error",
          message: stderr.trim() || `Codex exited with code ${code ?? "unknown"}`,
        });
        resolve();
        return;
      }
      if (!sawResult) {
        onEvent({
          kind: "result",
          subtype: "success",
          costUsd: null,
          turns: 1,
          durationMs: Date.now() - startedAt,
        });
      }
      resolve();
    });
    child.on("error", (err) => {
      signal.removeEventListener("abort", abort);
      if (!signal.aborted) {
        onEvent({
          kind: "error",
          message:
            err instanceof Error
              ? `${err.message}. Confirm the codex CLI is installed and logged in.`
              : String(err),
        });
      }
      resolve();
    });
  });
}

function spawnCodex(
  prompt: string,
  cwd: string | undefined,
  resumeSessionId: string | null | undefined,
  runConfig: RunConfig,
  runtime: ProviderRuntimeConfig | undefined,
): ChildProcessByStdio<null, Readable, Readable> {
  const args = [
    "--model",
    runConfig.model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(mapEffort(runConfig.effort))}`,
    "-c",
    `features.fast_mode=${runConfig.serviceTier === "fast" ? "true" : "false"}`,
    ...modeArgs(runConfig.mode, runConfig.fullAccess),
  ];
  if (runConfig.serviceTier === "fast") {
    args.push("-c", "service_tier=\"fast\"");
  }

  if (resumeSessionId) {
    args.push("exec", "resume", "--json", "--skip-git-repo-check", resumeSessionId, prompt);
  } else {
    args.push("exec", "--json", "--skip-git-repo-check");
    if (cwd) args.push("-C", cwd);
    args.push(prompt);
  }

  const configured = runtime?.binaryPath?.trim() || "codex";
  const spawnInput = codexSpawnInput(configured, args);
  const env = codexEnv(runtime);

  return spawn(spawnInput.command, spawnInput.args, {
    cwd: cwd ?? process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function codexSpawnInput(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command, args };
  if (/\.(exe)$/i.test(command) && hasPathSeparator(command)) return { command, args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}

function codexEnv(runtime: ProviderRuntimeConfig | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const home = runtime?.shadowHomePath?.trim() || runtime?.homePath?.trim();
  if (home) env.CODEX_HOME = home;
  return env;
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function modeArgs(mode: RunMode, fullAccess: boolean): string[] {
  if (fullAccess) return ["--dangerously-bypass-approvals-and-sandbox"];
  const sandbox = mode === "plan" ? "read-only" : "workspace-write";
  return ["--sandbox", sandbox, "--ask-for-approval", "never"];
}

function mapEffort(effort: RunConfig["effort"]): "low" | "medium" | "high" | "xhigh" {
  return effort === "max" ? "xhigh" : effort;
}

function parseJsonLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as CodexEvent;
  } catch {
    return null;
  }
}

function dispatchCodexEvent(
  event: CodexEvent,
  onEvent: (event: ChatEvent) => void,
  toolIds: Set<string>,
  startedAt: number,
  model: string,
  markResult: () => void,
): void {
  if (event.type === "thread.started") {
    onEvent({
      kind: "session_init",
      sessionId: event.thread_id,
      model,
      tools: ["shell_command"],
    });
    return;
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const item = event.item;
    if (!item?.id || !item.type) return;
    if (item.type === "agent_message" && event.type === "item.completed" && item.text) {
      onEvent({ kind: "assistant_text", text: item.text });
      return;
    }
    if (item.type !== "command_execution") return;
    if (!toolIds.has(item.id)) {
      toolIds.add(item.id);
      onEvent({
        kind: "tool_use",
        id: item.id,
        name: "shell_command",
        input: { command: item.command ?? "" },
      });
    }
    if (event.type === "item.completed") {
      onEvent({
        kind: "tool_result",
        toolUseId: item.id,
        output: item.aggregated_output ?? "",
        isError: typeof item.exit_code === "number" ? item.exit_code !== 0 : false,
      });
    }
    return;
  }
  if (event.type === "turn.completed") {
    markResult();
    onEvent({
      kind: "result",
      subtype: "success",
      costUsd: null,
      turns: 1,
      durationMs: Date.now() - startedAt,
    });
    return;
  }
  if (event.type === "error") {
    onEvent({ kind: "error", message: event.message ?? "Codex failed." });
  }
}

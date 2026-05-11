import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import type { ChatEvent, RunConfig } from "@shared/chat";
import {
  CURSOR_MODELS,
  type CursorCatalog,
  type ModelInfo,
  type ProviderRuntimeConfig,
} from "@shared/providers";

export type CursorRunOptions = {
  prompt: string;
  cwd?: string;
  resumeSessionId?: string | null;
  runConfig: RunConfig;
  runtime?: ProviderRuntimeConfig;
  signal: AbortSignal;
  onEvent: (event: ChatEvent) => void;
};

type CursorCommand = {
  path: string;
  displayName: string;
};

type CursorStreamEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  session_id?: string;
  thread_id?: string;
  duration_ms?: number;
  result?: string;
  error?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }> | string;
  };
  tool_call_id?: string;
  tool_call?: Record<string, unknown>;
};

let cursorCommandPromise:
  | {
      key: string;
      promise: Promise<CursorCommand>;
    }
  | null = null;

export async function loadCursorCatalog(runtime?: ProviderRuntimeConfig): Promise<CursorCatalog> {
  const checkedAt = Date.now();
  try {
    const command = await resolveCursorCommand(runtime);
    const status = await runCursorCommand(command, ["status"], { timeoutMs: 7_000 });
    if (status.code !== 0 || looksUnauthenticated(status.stdout, status.stderr)) {
      return unavailableCursorCatalog(
        checkedAt,
        true,
        cleanCursorError(status.stderr || status.stdout || "Cursor CLI is not authenticated."),
      );
    }

    const models = await readCursorModels(command);
    return {
      checkedAt,
      installed: true,
      available: true,
      status: firstNonEmptyLine(status.stdout) ?? "authenticated",
      models,
    };
  } catch (err) {
    return unavailableCursorCatalog(
      checkedAt,
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function runCursor({
  prompt,
  cwd,
  resumeSessionId,
  runConfig,
  runtime,
  signal,
  onEvent,
}: CursorRunOptions): Promise<void> {
  const startedAt = Date.now();
  const command = await resolveCursorCommand(runtime);
  const child = spawnCursor(command, prompt, cwd, resumeSessionId, runConfig, runtime);
  let stderr = "";
  let stdoutBuffer = "";
  let sawInit = false;
  let sawResult = false;
  const toolIds = new Set<string>();

  const abort = () => {
    if (!child.killed) child.kill();
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseJsonLine(line);
      if (!event) continue;
      dispatchCursorEvent(event, {
        onEvent,
        toolIds,
        startedAt,
        fallbackModel: runConfig.model,
        markInit: () => {
          sawInit = true;
        },
        markResult: () => {
          sawResult = true;
        },
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
        dispatchCursorEvent(event, {
          onEvent,
          toolIds,
          startedAt,
          fallbackModel: runConfig.model,
          markInit: () => {
            sawInit = true;
          },
          markResult: () => {
            sawResult = true;
          },
        });
      }
      if (code !== 0) {
        onEvent({
          kind: "error",
          message:
            stderr.trim() ||
            `Cursor CLI exited with code ${code ?? "unknown"}. Confirm the agent command is installed and authenticated.`,
        });
        resolve();
        return;
      }
      if (!sawInit) {
        onEvent({
          kind: "session_init",
          sessionId: resumeSessionId ?? undefinedSessionId(),
          model: runConfig.model,
          tools: ["cursor-agent"],
        });
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
              ? `${err.message}. Confirm the Cursor CLI agent command is installed and authenticated.`
              : String(err),
        });
      }
      resolve();
    });
  });
}

async function readCursorModels(command: CursorCommand): Promise<ModelInfo[]> {
  const result = await runCursorCommand(command, ["models"], { timeoutMs: 7_000 });
  if (result.code !== 0) return CURSOR_MODELS;
  const slugs = parseCursorModelSlugs(result.stdout);
  if (slugs.length === 0) return CURSOR_MODELS;
  const known = new Map(CURSOR_MODELS.map((model) => [model.value, model]));
  return slugs.map((slug) => known.get(slug) ?? cursorModelInfo(slug));
}

function spawnCursor(
  command: CursorCommand,
  prompt: string,
  cwd: string | undefined,
  resumeSessionId: string | null | undefined,
  runConfig: RunConfig,
  runtime: ProviderRuntimeConfig | undefined,
): ChildProcessByStdio<null, Readable, Readable> {
  const args = [
    ...cursorEndpointArgs(runtime),
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
  ];
  if (runConfig.fullAccess || runConfig.mode === "auto" || runConfig.mode === "auto-edit") {
    args.push("--force");
  }
  if (runConfig.model && runConfig.model !== "auto") {
    args.push("--model", runConfig.model);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  args.push(prompt);

  const spawnInput = spawnInputForCommand(command, args);
  return spawn(spawnInput.command, spawnInput.args, {
    cwd: cwd ?? process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: spawnInput.windowsVerbatimArguments,
  });
}

function dispatchCursorEvent(
  event: CursorStreamEvent,
  context: {
    onEvent: (event: ChatEvent) => void;
    toolIds: Set<string>;
    startedAt: number;
    fallbackModel: string;
    markInit: () => void;
    markResult: () => void;
  },
): void {
  if (event.type === "system" && event.subtype === "init") {
    context.markInit();
    context.onEvent({
      kind: "session_init",
      sessionId: event.session_id ?? event.thread_id ?? undefinedSessionId(),
      model: event.model ?? context.fallbackModel,
      tools: ["cursor-agent"],
    });
    return;
  }

  if (event.type === "assistant") {
    const text = assistantText(event.message?.content);
    if (text) context.onEvent({ kind: "assistant_text", text });
    return;
  }

  if (event.type === "tool_call") {
    const tool = normalizeToolCall(event);
    if (!tool) return;
    if (!context.toolIds.has(tool.id)) {
      context.toolIds.add(tool.id);
      context.onEvent({
        kind: "tool_use",
        id: tool.id,
        name: tool.name,
        input: tool.input,
      });
    }
    if (event.subtype === "completed") {
      context.onEvent({
        kind: "tool_result",
        toolUseId: tool.id,
        output: tool.output,
        isError: tool.isError,
      });
    }
    return;
  }

  if (event.type === "result") {
    context.markResult();
    context.onEvent({
      kind: "result",
      subtype: event.error ? "error" : "success",
      costUsd: null,
      turns: 1,
      durationMs:
        typeof event.duration_ms === "number" ? event.duration_ms : Date.now() - context.startedAt,
      errorText: event.error,
    });
  }
}

function assistantText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function normalizeToolCall(event: CursorStreamEvent): {
  id: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
} | null {
  const call = event.tool_call;
  if (!call || typeof call !== "object") return null;
  const entry = Object.entries(call).find(([, value]) => value && typeof value === "object");
  const raw = (entry?.[1] ?? call) as Record<string, unknown>;
  const name = entry?.[0]?.replace(/ToolCall$/, "") || "tool";
  const id =
    event.tool_call_id ??
    stringField(raw, "id") ??
    stringField(raw, "toolCallId") ??
    `cursor-tool-${contextFreeHash(JSON.stringify(call))}`;
  const input = raw.args ?? raw.input ?? call;
  const outputValue = raw.result ?? raw.output ?? "";
  return {
    id,
    name,
    input,
    output: stringify(outputValue),
    isError: Boolean(raw.error ?? raw.isError),
  };
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseJsonLine(line: string): CursorStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as CursorStreamEvent;
  } catch {
    return null;
  }
}

async function resolveCursorCommand(runtime?: ProviderRuntimeConfig): Promise<CursorCommand> {
  const key = runtime?.binaryPath?.trim() || "agent";
  if (!cursorCommandPromise || cursorCommandPromise.key !== key) {
    cursorCommandPromise = {
      key,
      promise: resolveConfiguredCommand(
        key,
        process.platform === "win32"
          ? ["agent.exe", "agent.cmd", "agent.ps1", "agent"]
          : ["agent"],
        commonCursorDirs(),
      ),
    };
    cursorCommandPromise.promise = cursorCommandPromise.promise.catch((err) => {
      cursorCommandPromise = null;
      throw err;
    });
  }
  return cursorCommandPromise.promise;
}

async function resolveConfiguredCommand(
  configured: string,
  defaults: string[],
  extraDirs: string[],
): Promise<CursorCommand> {
  const trimmed = configured.trim();
  if (trimmed && hasPathSeparator(trimmed)) {
    const file = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
    await access(file);
    return { path: file, displayName: basename(file) };
  }
  const names = trimmed && trimmed !== "agent" ? [trimmed, ...defaults] : defaults;
  return resolveCommand(names, extraDirs);
}

async function resolveCommand(names: string[], extraDirs: string[]): Promise<CursorCommand> {
  const dirs = uniquePaths([...splitPath(currentPath()), ...extraDirs]);
  for (const dir of dirs) {
    for (const name of names) {
      const file = join(dir, name);
      try {
        await access(file);
        return { path: file, displayName: basename(file) };
      } catch {
        // Try the next known install location.
      }
    }
  }
  throw new Error(
    "Cursor CLI agent command is not installed or not on PATH. Install it with: irm 'https://cursor.com/install?win32=true' | iex",
  );
}

function runCursorCommand(
  command: CursorCommand,
  args: string[],
  options?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const spawnInput = spawnInputForCommand(command, args);
    const child = spawn(spawnInput.command, spawnInput.args, {
      windowsHide: true,
      windowsVerbatimArguments: spawnInput.windowsVerbatimArguments,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer =
      typeof options?.timeoutMs === "number" && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            finish({ code: -1, stdout, stderr: `Timed out after ${options.timeoutMs}ms` });
          }, options.timeoutMs)
        : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      finish({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}

function spawnInputForCommand(command: CursorCommand, args: string[]): {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command.path)) {
    return { command: command.path, args };
  }
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", command.path, ...args],
  };
}

function commonCursorDirs(): string[] {
  const userHome = homedir();
  const dirs = [
    userHome ? join(userHome, ".local", "bin") : null,
    userHome ? join(userHome, ".cursor", "bin") : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "cursor-agent") : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps") : null,
    process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
  ];
  return dirs.filter((dir): dir is string => Boolean(dir));
}

function cursorEndpointArgs(runtime: ProviderRuntimeConfig | undefined): string[] {
  const endpoint = runtime?.apiEndpoint?.trim();
  return endpoint ? ["-e", endpoint] : [];
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function currentPath(): string {
  return process.env.PATH ?? process.env.Path ?? "";
}

function splitPath(value: string): string[] {
  return value.split(delimiter).filter((entry) => entry.trim().length > 0);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = normalizePath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function normalizePath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function parseCursorModelSlugs(output: string): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const candidate = line
      .trim()
      .replace(/^[-*]\s+/, "")
      .split(/\s+/)[0]
      ?.trim();
    if (!candidate || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(candidate)) continue;
    const lower = candidate.toLowerCase();
    if (["model", "models", "available", "name"].includes(lower)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    slugs.push(candidate);
  }
  return slugs;
}

function cursorModelInfo(slug: string): ModelInfo {
  return {
    value: slug,
    provider: "cursor",
    displayName: titleCaseSlug(slug),
    description: "Cursor CLI model from the user's authenticated account.",
    context: 200_000,
    supportsEffort: false,
    supportedEffortLevels: ["low", "medium", "high"],
    supportsAdaptiveThinking: false,
  };
}

function unavailableCursorCatalog(
  checkedAt: number,
  installed: boolean,
  error: string,
): CursorCatalog {
  return {
    checkedAt,
    installed,
    available: false,
    models: [],
    error: cleanCursorError(error),
  };
}

function looksUnauthenticated(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  return /not\s+(logged|authenticated)|unauthenticated|login required|please log in/.test(combined);
}

function cleanCursorError(error: string): string {
  return error.trim() || "Cursor CLI agent is unavailable.";
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function undefinedSessionId(): string {
  return `cursor-${randomUUID()}`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function contextFreeHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function titleCaseSlug(value: string): string {
  return value
    .replace(/[-_:.]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

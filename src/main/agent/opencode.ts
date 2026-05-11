import type {
  Event,
  GlobalEvent,
  Agent as OpenCodeAgent,
  Model as OpenCodeModel,
  Part,
  PermissionRuleset,
  Provider as OpenCodeProvider,
  QuestionRequest,
  Session,
  ToolPart,
  ToolFileContent,
  ToolTextContent,
} from "@opencode-ai/sdk/v2";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import type { ChatEvent, RunConfig } from "@shared/chat";
import type {
  ModelInfo,
  OpenCodeAgentInfo,
  OpenCodeCatalog,
  ProviderCatalog,
  ProviderRuntimeConfig,
} from "@shared/providers";

export type OpenCodeRunOptions = {
  prompt: string;
  cwd?: string;
  resumeSessionId?: string | null;
  runConfig: RunConfig;
  runtime?: ProviderRuntimeConfig;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
  requestPermission?: (
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<"allow" | "deny">;
  requestUserInput?: (
    requestId: string,
    questions: NormalizedOpenCodeQuestion[],
  ) => Promise<Record<string, string[]> | "reject">;
};

type NormalizedOpenCodeQuestion = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
  custom?: boolean;
};

type OpenCodeSdkModule = typeof import("@opencode-ai/sdk/v2");

let sdkPromise: Promise<OpenCodeSdkModule> | null = null;
let opencodePathPromise:
  | {
      key: string;
      promise: Promise<void>;
    }
  | null = null;

function loadSdk(): Promise<OpenCodeSdkModule> {
  if (!sdkPromise) {
    sdkPromise = import("@opencode-ai/sdk/v2");
  }
  return sdkPromise;
}

type SessionCreateResult = Awaited<ReturnType<OpenCodeSdkModule["createOpencodeClient"]>>;
type OpenCodeEvent = Event | GlobalEvent["payload"];

const MINIMUM_OPENCODE_VERSION = "1.14.19";
const OPENCODE_VERSION_TIMEOUT_MS = 5_000;

function ensureOpenCodeOnPath(runtime?: ProviderRuntimeConfig): Promise<void> {
  const key = runtime?.binaryPath?.trim() || "opencode";
  if (!opencodePathPromise || opencodePathPromise.key !== key) {
    opencodePathPromise = {
      key,
      promise: resolveOpenCodePathDirs(runtime).then((dirsToAdd) => {
        const current = currentPath();
        const dirs = splitPath(current);
        const missing = dirsToAdd.filter(
          (dir) => !dirs.some((entry) => samePath(entry, dir)),
        );
        if (missing.length === 0) return;
        const next = [...missing, ...dirs].join(delimiter);
        process.env.PATH = next;
        process.env.Path = next;
      }),
    };
    opencodePathPromise.promise = opencodePathPromise.promise.catch((err) => {
      opencodePathPromise = null;
      throw err;
    });
  }
  return opencodePathPromise.promise;
}

async function ensureOpenCodeReady(runtime?: ProviderRuntimeConfig): Promise<void> {
  await ensureOpenCodeOnPath(runtime);
  const version = await readOpenCodeVersion(runtime);
  if (!version.parsed) {
    throw new Error(
      `opencode CLI version output was not recognized: ${version.raw || "(empty output)"}.`,
    );
  }
  if (compareSemver(version.parsed, parseSemver(MINIMUM_OPENCODE_VERSION)!) < 0) {
    throw new Error(
      `opencode CLI ${version.raw} is too old. Install opencode ${MINIMUM_OPENCODE_VERSION} or newer.`,
    );
  }
}

async function resolveOpenCodePathDirs(runtime?: ProviderRuntimeConfig): Promise<string[]> {
  const opencodeDir = await resolveOpenCodeDir(runtime);
  const nodeDir = await resolveCommandDir(["node.exe", "node"], commonNodeDirs()).catch(
    () => null,
  );
  return nodeDir ? [opencodeDir, nodeDir] : [opencodeDir];
}

async function resolveOpenCodeDir(runtime?: ProviderRuntimeConfig): Promise<string> {
  const configured = runtime?.binaryPath?.trim();
  if (configured && hasPathSeparator(configured)) {
    const file = isAbsolute(configured) ? configured : resolve(configured);
    await access(file);
    return dirname(file);
  }
  return resolveCommandDir(
    configured && configured !== "opencode"
      ? [configured, ...(process.platform === "win32"
          ? ["opencode.cmd", "opencode.exe", "opencode", "opencode.ps1"]
          : ["opencode"])]
      : process.platform === "win32"
        ? ["opencode.cmd", "opencode.exe", "opencode", "opencode.ps1"]
        : ["opencode"],
    commonOpenCodeDirs(),
  ).catch(() => {
    throw new Error("opencode CLI is not installed or not on PATH.");
  });
}

async function resolveCommandDir(names: string[], extraDirs: string[]): Promise<string> {
  const dirs = uniquePaths([...splitPath(currentPath()), ...extraDirs]);

  for (const dir of dirs) {
    for (const name of names) {
      const file = join(dir, name);
      try {
        await access(file);
        return dirname(file);
      } catch {
        // Try the next known install location.
      }
    }
  }

  throw new Error(`${names[0]} is not installed or not on PATH.`);
}

function commonOpenCodeDirs(): string[] {
  const userHome = homedir();
  const dirs = [
    process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "pnpm") : null,
    process.env.APPDATA ? join(process.env.APPDATA, "pnpm") : null,
    userHome ? join(userHome, ".bun", "bin") : null,
    userHome ? join(userHome, ".local", "bin") : null,
  ];
  return dirs.filter((dir): dir is string => Boolean(dir));
}

function commonNodeDirs(): string[] {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const dirs = [
    programFiles ? join(programFiles, "nodejs") : null,
    programFilesX86 ? join(programFilesX86, "nodejs") : null,
    localAppData ? join(localAppData, "Programs", "nodejs") : null,
  ];
  return dirs.filter((dir): dir is string => Boolean(dir));
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

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export async function loadOpenCodeCatalog(
  directory = process.cwd(),
  runtime?: ProviderRuntimeConfig,
): Promise<ProviderCatalog> {
  const checkedAt = Date.now();
  let server: { url: string; close(): void } | null = null;

  try {
    await ensureOpenCodeReady(runtime);
    const { createOpencodeClient, createOpencodeServer } = await loadSdk();
    const serverUrl = runtime?.serverUrl?.trim();
    server = serverUrl
      ? { url: serverUrl, close() {} }
      : await createOpencodeServer({
          port: 0,
          timeout: 5_000,
          config: {},
        });
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory,
      ...openCodeClientAuth(runtime),
      throwOnError: true,
    });
    const result = await client.provider.list({ directory }, { throwOnError: true });
    const agentsResult = await client.app.agents({ directory }, { throwOnError: true });
    const connected = new Set(result.data.connected);
    const connectedProviders = result.data.all.filter((provider) => connected.has(provider.id));
    const models = connectedProviders.flatMap(providerToModels);
    const agents = agentsResult.data
      .filter((agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"))
      .map(openCodeAgentToInfo)
      .sort((left, right) => agentSortKey(left).localeCompare(agentSortKey(right)));
    return {
      opencode: {
        checkedAt,
        installed: true,
        available: models.length > 0,
        connectedProviderIds: connectedProviders.map((provider) => provider.id),
        models,
        agents,
      },
    };
  } catch (err) {
    return {
      opencode: unavailableOpenCodeCatalog(
        checkedAt,
        err instanceof Error ? err.message : String(err),
      ),
    };
  } finally {
    server?.close();
  }
}

function unavailableOpenCodeCatalog(checkedAt: number, error: string): OpenCodeCatalog {
  return {
    checkedAt,
    installed: !isMissingOpenCodeCli(error),
    available: false,
    connectedProviderIds: [],
    models: [],
    agents: [],
    error: cleanOpenCodeCatalogError(error),
  };
}

function openCodeAgentToInfo(agent: OpenCodeAgent): OpenCodeAgentInfo {
  return {
    name: agent.name,
    displayName: titleCaseSlug(agent.name),
    description: agent.description,
  };
}

function agentSortKey(agent: OpenCodeAgentInfo): string {
  if (agent.name === "build") return "0";
  if (agent.name === "plan") return "1";
  return `2-${agent.displayName}`;
}

function titleCaseSlug(value: string): string {
  return value
    .split(/[-_/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function isMissingOpenCodeCli(message: string): boolean {
  return /ENOENT|not found|cannot find|spawn opencode/i.test(message);
}

function cleanOpenCodeCatalogError(message: string): string {
  if (isMissingOpenCodeCli(message)) return "opencode CLI is not installed or not on PATH.";
  if (/opencode CLI version output was not recognized/i.test(message)) {
    return "opencode CLI is installed, but its version could not be read.";
  }
  if (/opencode CLI .+ is too old/i.test(message)) {
    return message.trim();
  }
  if (/Timeout waiting for server to start/i.test(message)) {
    return "opencode CLI did not start within 5 seconds.";
  }
  return message.trim() || "OpenCode is not available.";
}

async function readOpenCodeVersion(runtime?: ProviderRuntimeConfig): Promise<{
  raw: string;
  parsed: [number, number, number] | null;
}> {
  const result = await runOpenCodeCommand(["--version"], OPENCODE_VERSION_TIMEOUT_MS, runtime);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "opencode CLI version check failed.");
  }
  const raw = firstNonEmptyLine(result.stdout || result.stderr) ?? "";
  return { raw, parsed: parseSemver(raw) };
}

function runOpenCodeCommand(
  args: string[],
  timeoutMs: number,
  runtime?: ProviderRuntimeConfig,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const spawnInput = openCodeSpawnInput(args, runtime);
    const child = spawn(spawnInput.command, spawnInput.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: -1, stdout, stderr: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);
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

function openCodeSpawnInput(
  args: string[],
  runtime?: ProviderRuntimeConfig,
): { command: string; args: string[] } {
  const configured = runtime?.binaryPath?.trim() || "opencode";
  if (process.platform !== "win32") return { command: configured, args };
  if (/\.(exe)$/i.test(configured) && hasPathSeparator(configured)) {
    return { command: configured, args };
  }
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", configured, ...args],
  };
}

function openCodeClientAuth(
  runtime: ProviderRuntimeConfig | undefined,
): { headers?: Record<string, string> } {
  const password = runtime?.serverPassword?.trim();
  if (!password) return {};
  return {
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`,
    },
  };
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function providerToModels(provider: OpenCodeProvider): ModelInfo[] {
  return Object.values(provider.models ?? {})
    .filter((model) => model.status !== "deprecated" && model.capabilities.output.text)
    .map((model) => openCodeModelToModelInfo(provider, model));
}

function openCodeModelToModelInfo(provider: OpenCodeProvider, model: OpenCodeModel): ModelInfo {
  const supportedEffortLevels = supportedEffortsForOpenCodeModel(model);
  return {
    value: `${provider.id}/${model.id}`,
    provider: "opencode",
    displayName: model.name,
    description: `${provider.name} via local OpenCode auth.`,
    context: model.limit.context,
    supportsEffort: supportedEffortLevels.length > 1 || model.capabilities.reasoning,
    supportedEffortLevels,
    supportsAdaptiveThinking: false,
  };
}

function supportedEffortsForOpenCodeModel(model: OpenCodeModel): RunConfig["effort"][] {
  const variants = Object.entries(model.variants ?? {})
    .filter(([, variant]) => variant.disabled !== true)
    .map(([variant]) => variant)
    .filter((variant): variant is RunConfig["effort"] => isDebaseEffort(variant));
  if (variants.length > 0) return variants;
  if (model.capabilities.reasoning) return ["low", "medium", "high"];
  return ["medium"];
}

function isDebaseEffort(value: string): value is RunConfig["effort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

export async function runOpenCode({
  prompt,
  cwd,
  resumeSessionId,
  runConfig,
  runtime,
  signal,
  onEvent,
  requestPermission,
  requestUserInput,
}: OpenCodeRunOptions): Promise<void> {
  const startedAt = Date.now();
  const directory = cwd ?? process.cwd();
  const abortController = new AbortController();
  const externalSignal = signal ?? abortController.signal;
  const abort = () => abortController.abort();
  if (externalSignal.aborted) abort();
  else externalSignal.addEventListener("abort", abort, { once: true });

  let server: { url: string; close(): void } | null = null;
  let eventPumpDone: Promise<void> | null = null;
  let sawTerminalEvent = false;

  try {
    await ensureOpenCodeReady(runtime);
    const { createOpencodeClient, createOpencodeServer } = await loadSdk();
    const serverUrl = runtime?.serverUrl?.trim();
    server = serverUrl
      ? { url: serverUrl, close() {} }
      : await createOpencodeServer({
          port: 0,
          signal: abortController.signal,
          config: {},
        });
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory,
      ...openCodeClientAuth(runtime),
      throwOnError: true,
    });

    const session = resumeSessionId
      ? ({ id: resumeSessionId } as Session)
      : await createSession(client, runConfig, prompt, directory, requestPermission);
    const sessionId = session.id;
    const state = createEventState(sessionId, runConfig.model, startedAt, onEvent);
    onEvent({
      kind: "session_init",
      sessionId,
      model: runConfig.model,
      tools: ["bash", "edit", "write", "webfetch", "websearch"],
    });

    state.resolveRun = () => {
      sawTerminalEvent = true;
    };

    eventPumpDone = (async () => {
      const subscription = await client.global.event({ signal: abortController.signal });
      for await (const globalEvent of subscription.stream) {
        if (abortController.signal.aborted) break;
        const event = globalEvent.payload;
        await dispatchOpenCodeEvent(event, state, client, requestPermission, requestUserInput);
      }
    })();

    await client.session.promptAsync(
      {
        sessionID: sessionId,
        directory,
        model: parseOpenCodeModel(runConfig.model),
        agent: runConfig.opencodeAgent ?? (runConfig.mode === "plan" ? "plan" : undefined),
        variant: mapVariant(runConfig.effort),
        parts: [{ type: "text", text: prompt }],
      },
      { signal: abortController.signal },
    );

    await waitForOpenCodeIdle(client, sessionId, directory, abortController.signal, state);

    if (!externalSignal.aborted && !sawTerminalEvent && !state.terminalEmitted) {
      emitTerminalResult(state, {
        kind: "result",
        subtype: "success",
        costUsd: state.lastStepCostUsd,
        turns: Math.max(1, state.turns),
        durationMs: Date.now() - startedAt,
      });
    }
  } catch (err) {
    if (!externalSignal.aborted) {
      onEvent({
        kind: "error",
        message:
          err instanceof Error
            ? `${err.message}. Confirm the opencode CLI is installed and logged in.`
            : String(err),
      });
    }
  } finally {
    abortController.abort();
    externalSignal.removeEventListener("abort", abort);
    server?.close();
    server = null;
    if (eventPumpDone) {
      await Promise.race([eventPumpDone.catch(() => undefined), sleep(1_000)]);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSession(
  client: SessionCreateResult,
  runConfig: RunConfig,
  prompt: string,
  directory: string,
  requestPermission: OpenCodeRunOptions["requestPermission"],
): Promise<Session> {
  const result = await client.session.create(
    {
      directory,
      title: prompt.trim().slice(0, 60) || "debase thread",
      model: {
        providerID: parseOpenCodeModel(runConfig.model).providerID,
        id: parseOpenCodeModel(runConfig.model).modelID,
        variant: mapVariant(runConfig.effort),
      },
      permission: buildPermissionRules(runConfig, Boolean(requestPermission)),
    },
    { throwOnError: true },
  );
  return result.data;
}

type OpenCodeEventState = {
  sessionId: string;
  model: string;
  startedAt: number;
  onEvent: (event: ChatEvent) => void;
  messageRoleById: Map<string, "assistant" | "user">;
  partById: Map<string, Part>;
  emittedTextByPartId: Map<string, string>;
  emittedToolUseIds: Set<string>;
  emittedAssistantText: string;
  emittedNextText: string;
  emittedNextReasoningById: Map<string, string>;
  nextToolInputById: Map<string, string>;
  questionByRequestId: Map<string, QuestionRequest>;
  lastStepCostUsd: number | null;
  turns: number;
  terminalEmitted: boolean;
  resolveRun: () => void;
};

function createEventState(
  sessionId: string,
  model: string,
  startedAt: number,
  onEvent: (event: ChatEvent) => void,
): OpenCodeEventState {
  return {
    sessionId,
    model,
    startedAt,
    onEvent,
    messageRoleById: new Map(),
    partById: new Map(),
    emittedTextByPartId: new Map(),
    emittedToolUseIds: new Set(),
    emittedAssistantText: "",
    emittedNextText: "",
    emittedNextReasoningById: new Map(),
    nextToolInputById: new Map(),
    questionByRequestId: new Map(),
    lastStepCostUsd: null,
    turns: 0,
    terminalEmitted: false,
    resolveRun: () => undefined,
  };
}

async function waitForOpenCodeIdle(
  client: SessionCreateResult,
  sessionId: string,
  directory: string,
  signal: AbortSignal,
  state: OpenCodeEventState,
): Promise<void> {
  while (!signal.aborted && !state.terminalEmitted) {
    const response = await client.session.status({ directory }, { signal });
    const status = response.data?.[sessionId];
    if (status?.type === "idle") {
      await abortableDelay(50, signal);
      return;
    }
    await abortableDelay(250, signal);
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function dispatchOpenCodeEvent(
  event: OpenCodeEvent,
  state: OpenCodeEventState,
  client: SessionCreateResult,
  requestPermission: OpenCodeRunOptions["requestPermission"],
  requestUserInput: OpenCodeRunOptions["requestUserInput"],
): Promise<void> {
  if (!isEventForSession(event, state.sessionId)) return;

  switch (event.type) {
    case "message.updated": {
      state.messageRoleById.set(event.properties.info.id, event.properties.info.role);
      if (event.properties.info.role === "assistant") {
        for (const part of state.partById.values()) {
          if (part.messageID === event.properties.info.id) {
            emitTextPartDelta(part, state);
          }
        }
      }
      return;
    }
    case "message.removed": {
      state.messageRoleById.delete(event.properties.messageID);
      return;
    }
    case "message.part.delta": {
      const part = state.partById.get(event.properties.partID);
      if (!part || !isAssistantPart(part, state)) return;
      if (part.type !== "text" && part.type !== "reasoning") return;
      const previous = state.emittedTextByPartId.get(part.id) ?? part.text ?? "";
      const next = previous + event.properties.delta;
      state.emittedTextByPartId.set(part.id, next);
      state.partById.set(part.id, { ...part, text: next });
      if (event.properties.delta.length > 0) {
        if (part.type === "reasoning") {
          state.onEvent({ kind: "thinking", text: event.properties.delta });
        } else {
          emitAssistantTextDelta(event.properties.delta, state);
        }
      }
      return;
    }
    case "message.part.updated": {
      const part = event.properties.part;
      state.partById.set(part.id, part);
      if (isAssistantPart(part, state)) {
        emitTextPartDelta(part, state);
      }
      if (part.type === "tool") {
        emitToolPart(part, state);
      }
      return;
    }
    case "session.next.text.delta": {
      emitNextTextDelta(event.properties.delta, state);
      return;
    }
    case "session.next.text.ended": {
      emitNextTextFinal(event.properties.text, state);
      return;
    }
    case "session.next.reasoning.delta": {
      emitNextReasoningDelta(
        event.properties.reasoningID,
        event.properties.delta,
        state,
      );
      return;
    }
    case "session.next.reasoning.ended": {
      emitNextReasoningFinal(
        event.properties.reasoningID,
        event.properties.text,
        state,
      );
      return;
    }
    case "session.next.tool.input.started": {
      state.nextToolInputById.set(event.properties.callID, "");
      return;
    }
    case "session.next.tool.input.delta": {
      const previous = state.nextToolInputById.get(event.properties.callID) ?? "";
      state.nextToolInputById.set(event.properties.callID, previous + event.properties.delta);
      return;
    }
    case "session.next.tool.input.ended": {
      state.nextToolInputById.set(event.properties.callID, event.properties.text);
      return;
    }
    case "session.next.tool.called": {
      emitNextToolUse(event.properties.callID, event.properties.tool, event.properties.input, state);
      return;
    }
    case "session.next.tool.progress": {
      const output = toolContentToText(event.properties.content);
      if (output.length > 0) {
        state.onEvent({
          kind: "tool_result",
          toolUseId: event.properties.callID,
          output,
          isError: false,
        });
      }
      return;
    }
    case "session.next.tool.success": {
      state.onEvent({
        kind: "tool_result",
        toolUseId: event.properties.callID,
        output: toolContentToText(event.properties.content),
        isError: false,
      });
      return;
    }
    case "session.next.tool.failed": {
      state.onEvent({
        kind: "tool_result",
        toolUseId: event.properties.callID,
        output: unknownErrorMessage(event.properties.error, "OpenCode tool failed."),
        isError: true,
      });
      return;
    }
    case "session.next.step.ended": {
      state.turns += 1;
      state.lastStepCostUsd = event.properties.cost;
      return;
    }
    case "session.next.step.failed": {
      emitTerminalResult(state, {
        kind: "error",
        message: unknownErrorMessage(event.properties.error, "OpenCode session failed."),
      });
      return;
    }
    case "session.next.retried": {
      state.onEvent({
        kind: "thinking",
        text: `Retrying: ${event.properties.error.message}`,
      });
      return;
    }
    case "permission.asked": {
      const toolUseId = event.properties.tool?.callID ?? event.properties.id;
      const toolName = String(event.properties.metadata.tool ?? event.properties.permission);
      if (!state.emittedToolUseIds.has(toolUseId)) {
        state.emittedToolUseIds.add(toolUseId);
        state.onEvent({
          kind: "tool_use",
          id: toolUseId,
          name: toolName,
          input: event.properties.metadata,
        });
      }
      const decision = requestPermission
        ? await requestPermission(toolName, event.properties.metadata, toolUseId)
        : "allow";
      await client.permission.reply(
        {
          requestID: event.properties.id,
          reply: decision === "allow" ? "once" : "reject",
        },
        { throwOnError: true },
      );
      return;
    }
    case "question.asked": {
      state.questionByRequestId.set(event.properties.id, event.properties);
      const questions = normalizeQuestionRequest(event.properties);
      state.onEvent({
        kind: "user_input_request",
        requestId: event.properties.id,
        questions,
      });
      const answers = requestUserInput
        ? await requestUserInput(event.properties.id, questions)
        : "reject";
      if (answers === "reject") {
        await client.question.reject(
          { requestID: event.properties.id },
          { throwOnError: true },
        );
        state.questionByRequestId.delete(event.properties.id);
        emitUserInputResolved(state, event.properties.id, {}, true);
        return;
      }
      await client.question.reply(
        {
          requestID: event.properties.id,
          answers: toOpenCodeQuestionAnswers(event.properties, answers),
        },
        { throwOnError: true },
      );
      state.questionByRequestId.delete(event.properties.id);
      emitUserInputResolved(state, event.properties.id, answers, false);
      return;
    }
    case "question.replied": {
      const request = state.questionByRequestId.get(event.properties.requestID);
      state.questionByRequestId.delete(event.properties.requestID);
      const answers = Object.fromEntries(
        (request?.questions ?? []).map((question, index) => [
          openCodeQuestionId(index, question),
          event.properties.answers[index] ?? [],
        ]),
      );
      emitUserInputResolved(state, event.properties.requestID, answers, false);
      return;
    }
    case "question.rejected": {
      state.questionByRequestId.delete(event.properties.requestID);
      emitUserInputResolved(state, event.properties.requestID, {}, true);
      return;
    }
    case "session.status": {
      if (event.properties.status.type === "idle") {
        emitTerminalResult(state, {
          kind: "result",
          subtype: "success",
          costUsd: state.lastStepCostUsd,
          turns: Math.max(1, state.turns),
          durationMs: Date.now() - state.startedAt,
        });
      } else if (event.properties.status.type === "retry") {
        state.onEvent({
          kind: "thinking",
          text: `Retrying: ${event.properties.status.message}`,
        });
      }
      return;
    }
    case "session.idle": {
      emitTerminalResult(state, {
        kind: "result",
        subtype: "success",
        costUsd: state.lastStepCostUsd,
        turns: Math.max(1, state.turns),
        durationMs: Date.now() - state.startedAt,
      });
      return;
    }
    case "session.error": {
      emitTerminalResult(state, {
        kind: "error",
        message: sessionErrorMessage(event.properties.error),
      });
      return;
    }
    default:
      return;
  }
}

function emitTerminalResult(state: OpenCodeEventState, event: ChatEvent): void {
  if (state.terminalEmitted) return;
  state.terminalEmitted = true;
  state.onEvent(event);
  state.resolveRun();
}

function emitAssistantTextDelta(delta: string, state: OpenCodeEventState): void {
  if (delta.length === 0) return;
  state.emittedAssistantText += delta;
  state.onEvent({ kind: "assistant_text", text: delta });
}

function emitNextTextDelta(delta: string, state: OpenCodeEventState): void {
  if (delta.length === 0) return;
  state.emittedNextText += delta;
  emitAssistantTextDelta(delta, state);
}

function emitNextTextFinal(text: string, state: OpenCodeEventState): void {
  const latest = resolveLatestText(state.emittedAssistantText, text);
  const delta = latest.slice(commonPrefixLength(state.emittedAssistantText, latest));
  state.emittedAssistantText = latest;
  state.emittedNextText = latest;
  if (delta.length > 0) {
    state.onEvent({ kind: "assistant_text", text: delta });
  }
}

function emitNextReasoningDelta(
  reasoningId: string,
  delta: string,
  state: OpenCodeEventState,
): void {
  if (delta.length === 0) return;
  const previous = state.emittedNextReasoningById.get(reasoningId) ?? "";
  state.emittedNextReasoningById.set(reasoningId, previous + delta);
  state.onEvent({ kind: "thinking", text: delta });
}

function emitNextReasoningFinal(
  reasoningId: string,
  text: string,
  state: OpenCodeEventState,
): void {
  const previous = state.emittedNextReasoningById.get(reasoningId) ?? "";
  const latest = resolveLatestText(previous, text);
  const delta = latest.slice(commonPrefixLength(previous, latest));
  state.emittedNextReasoningById.set(reasoningId, latest);
  if (delta.length > 0) {
    state.onEvent({ kind: "thinking", text: delta });
  }
}

function emitNextToolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
  state: OpenCodeEventState,
): void {
  if (state.emittedToolUseIds.has(id)) return;
  state.emittedToolUseIds.add(id);
  state.onEvent({
    kind: "tool_use",
    id,
    name,
    input,
  });
}

function emitUserInputResolved(
  state: OpenCodeEventState,
  requestId: string,
  answers: Record<string, string[]>,
  rejected: boolean,
): void {
  state.onEvent({
    kind: "user_input_resolved",
    requestId,
    answers,
    rejected,
  });
}

function normalizeQuestionRequest(request: QuestionRequest): NormalizedOpenCodeQuestion[] {
  return request.questions.map((question, index) => ({
    id: openCodeQuestionId(index, question),
    header: question.header,
    question: question.question,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description,
    })),
    ...(question.multiple ? { multiSelect: true } : {}),
    ...(question.custom ? { custom: true } : {}),
  }));
}

function toOpenCodeQuestionAnswers(
  request: QuestionRequest,
  answers: Record<string, string[]>,
): string[][] {
  return request.questions.map((question, index) => {
    const id = openCodeQuestionId(index, question);
    return normalizeAnswerList(
      answers[id] ?? answers[question.header] ?? answers[question.question] ?? [],
    );
  });
}

function openCodeQuestionId(
  index: number,
  question: QuestionRequest["questions"][number],
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`;
}

function normalizeAnswerList(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function resolveLatestText(previousText: string, nextText: string): string {
  if (previousText.length > nextText.length && previousText.startsWith(nextText)) {
    return previousText;
  }
  return nextText;
}

function toolContentToText(content: Array<ToolTextContent | ToolFileContent>): string {
  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      return item.name ? `${item.name}: ${item.uri}` : item.uri;
    })
    .filter((text) => text.trim().length > 0)
    .join("\n");
}

function unknownErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message;
    }
    const data = record.data;
    if (data && typeof data === "object") {
      const dataMessage = (data as Record<string, unknown>).message;
      if (typeof dataMessage === "string" && dataMessage.trim().length > 0) {
        return dataMessage;
      }
    }
  }
  return fallback;
}

function isEventForSession(event: OpenCodeEvent, sessionId: string): boolean {
  if (!("properties" in event)) return false;
  const props = event.properties as { sessionID?: unknown };
  return props.sessionID === sessionId;
}

function isAssistantPart(part: Part, state: OpenCodeEventState): boolean {
  return state.messageRoleById.get(part.messageID) === "assistant";
}

function emitTextPartDelta(part: Part, state: OpenCodeEventState): void {
  if (part.type !== "text" && part.type !== "reasoning") return;
  const previous = state.emittedTextByPartId.get(part.id) ?? "";
  const latest = part.text;
  if (latest.length <= previous.length && previous.startsWith(latest)) return;
  const prefix = commonPrefixLength(previous, latest);
  const delta = latest.slice(prefix);
  state.emittedTextByPartId.set(part.id, latest);
  if (delta.length === 0) return;
  if (part.type === "reasoning") {
    state.onEvent({ kind: "thinking", text: delta });
  } else {
    emitAssistantTextDelta(delta, state);
  }
}

function emitToolPart(part: ToolPart, state: OpenCodeEventState): void {
  const id = part.callID || part.id;
  if (!state.emittedToolUseIds.has(id)) {
    state.emittedToolUseIds.add(id);
    state.onEvent({
      kind: "tool_use",
      id,
      name: part.tool,
      input: "input" in part.state ? part.state.input : {},
    });
  }

  if (part.state.status === "completed") {
    state.onEvent({
      kind: "tool_result",
      toolUseId: id,
      output: part.state.output,
      isError: false,
    });
  } else if (part.state.status === "error") {
    state.onEvent({
      kind: "tool_result",
      toolUseId: id,
      output: part.state.error,
      isError: true,
    });
  }
}

function buildPermissionRules(
  runConfig: RunConfig,
  askBeforeTools: boolean,
): PermissionRuleset {
  if (runConfig.fullAccess) {
    return [{ permission: "*", pattern: "*", action: "allow" }];
  }
  if (runConfig.mode === "plan" && !askBeforeTools) {
    return [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "*", pattern: "*", action: "allow" },
    ];
  }
  if (!askBeforeTools) {
    return [{ permission: "*", pattern: "*", action: "allow" }];
  }
  return [
    { permission: "question", pattern: "*", action: "allow" },
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "webfetch", pattern: "*", action: "ask" },
    { permission: "websearch", pattern: "*", action: "ask" },
    { permission: "external_directory", pattern: "*", action: "ask" },
  ];
}

function parseOpenCodeModel(value: string): { providerID: string; modelID: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return { providerID: "opencode", modelID: value };
  }
  return {
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  };
}

function mapVariant(effort: RunConfig["effort"]): string | undefined {
  if (effort === "max") return "max";
  if (effort === "xhigh") return "high";
  return effort;
}

function sessionErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "OpenCode session failed.";
  const data = "data" in error && error.data && typeof error.data === "object" ? error.data : null;
  const message = data && "message" in data ? data.message : null;
  if (typeof message === "string" && message.trim().length > 0) return message;
  return "OpenCode session failed.";
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

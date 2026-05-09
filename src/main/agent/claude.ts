import type {
  EffortLevel as SdkEffortLevel,
  Options,
  PermissionMode,
  Query,
  SDKMessage,
  ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatEvent, RunConfig, RunMode } from "@shared/chat";
import { modelSupports1MBeta } from "@shared/providers";

export type ClaudeRunOptions = {
  prompt: string;
  cwd?: string;
  resumeSessionId?: string | null;
  runConfig: RunConfig;
  signal: AbortSignal;
  onEvent: (event: ChatEvent) => void;
};

type SdkModule = typeof import("@anthropic-ai/claude-agent-sdk");

let sdkPromise: Promise<SdkModule> | null = null;

function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) {
    sdkPromise = import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkPromise;
}

export async function runClaude({
  prompt,
  cwd,
  resumeSessionId,
  runConfig,
  signal,
  onEvent,
}: ClaudeRunOptions): Promise<void> {
  const options: Options = {
    model: runConfig.model,
    permissionMode: runConfig.fullAccess ? "bypassPermissions" : mapMode(runConfig.mode),
    cwd: cwd ?? process.cwd(),
    abortController: toAbortController(signal),
    thinking: mapThinking(runConfig),
    effort: runConfig.effort as SdkEffortLevel,
  };

  if (runConfig.fallbackModel) {
    options.fallbackModel = runConfig.fallbackModel;
  }

  if (runConfig.fullAccess) {
    options.allowDangerouslySkipPermissions = true;
  }

  if (runConfig.context1M && modelSupports1MBeta(runConfig.model)) {
    options.betas = ["context-1m-2025-08-07"];
  }

  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  let q: Query | null = null;

  try {
    const { query } = await loadSdk();
    q = query({ prompt, options });
    for await (const message of q) {
      if (signal.aborted) break;
      dispatchMessage(message, onEvent);
    }
  } catch (err) {
    if (signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    onEvent({ kind: "error", message: msg });
  }
}

function mapMode(mode: RunMode): PermissionMode {
  switch (mode) {
    case "plan":
      return "plan";
    case "build":
      return "default";
    case "auto-edit":
      return "acceptEdits";
    case "auto":
      return "auto";
    default: {
      // Compile-time exhaustiveness check; if RunMode gains a value, this
      // line stops compiling instead of silently returning `undefined`.
      const _exhaustive: never = mode;
      void _exhaustive;
      return "default";
    }
  }
}

function mapThinking(runConfig: RunConfig): ThinkingConfig {
  if (runConfig.thinking === "disabled") return { type: "disabled" };
  if (runConfig.thinking === "enabled") {
    return {
      type: "enabled",
      budgetTokens: runConfig.thinkingBudget ?? 8000,
    };
  }
  return { type: "adaptive" };
}

function dispatchMessage(message: SDKMessage, onEvent: (e: ChatEvent) => void): void {
  switch (message.type) {
    case "system": {
      if (message.subtype === "init") {
        onEvent({
          kind: "session_init",
          sessionId: message.session_id,
          model: message.model,
          tools: message.tools ?? [],
        });
      }
      return;
    }
    case "assistant": {
      const content = message.message.content;
      if (typeof content === "string") {
        onEvent({ kind: "assistant_text", text: content });
        return;
      }
      for (const block of content) {
        if (block.type === "text") {
          onEvent({ kind: "assistant_text", text: block.text });
        } else if (block.type === "thinking") {
          onEvent({ kind: "thinking", text: block.thinking });
        } else if (block.type === "tool_use") {
          onEvent({
            kind: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      return;
    }
    case "user": {
      const content = message.message.content;
      if (typeof content === "string") return;
      for (const block of content) {
        if (block.type === "tool_result") {
          onEvent({
            kind: "tool_result",
            toolUseId: block.tool_use_id,
            output: stringifyToolResult(block.content),
            isError: block.is_error === true,
          });
        }
      }
      return;
    }
    case "result": {
      onEvent({
        kind: "result",
        subtype: message.subtype === "success" ? "success" : "error",
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
        turns: message.num_turns ?? 0,
        durationMs: message.duration_ms ?? 0,
        errorText:
          message.subtype !== "success"
            ? message.subtype === "error_max_turns"
              ? "Max turns reached"
              : message.subtype === "error_during_execution"
                ? "Error during execution"
                : "Error"
            : undefined,
      });
      return;
    }
    default:
      return;
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item && typeof item === "object" && "type" in item) {
          const obj = item as { type: string; text?: string };
          if (obj.type === "text" && typeof obj.text === "string") return obj.text;
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function toAbortController(signal: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (signal.aborted) {
    ctrl.abort();
    return ctrl;
  }
  signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  return ctrl;
}

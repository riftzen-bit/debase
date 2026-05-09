import type {
  CanUseTool,
  EffortLevel as SdkEffortLevel,
  Options,
  PermissionMode,
  PermissionResult,
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
  /**
   * When provided, every tool call is gated through this hook. Resolves to
   * "allow" or "deny" — typically wired by the IPC layer to a renderer
   * approval card. Omit to keep the SDK's default auto-allow behaviour.
   */
  requestPermission?: (
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<"allow" | "deny">;
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
  requestPermission,
}: ClaudeRunOptions): Promise<void> {
  const options: Options = {
    model: runConfig.model,
    permissionMode: runConfig.fullAccess ? "bypassPermissions" : mapMode(runConfig.mode),
    cwd: cwd ?? process.cwd(),
    abortController: toAbortController(signal),
    thinking: mapThinking(runConfig),
    effort: runConfig.effort as SdkEffortLevel,
    // The SDK's built-in AskUserQuestion tool only resolves when there is an
    // interactive TTY (the Claude Code CLI). Inside an Agent SDK host it
    // auto-cancels and the agent is forced to ask via plain text afterwards
    // — which presents to the user as a ghost "answered" card they never
    // touched. Disabling the tool keeps the conversation clean: Claude just
    // asks in prose and the user replies in the composer like any turn.
    disallowedTools: ["AskUserQuestion"],
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

  // Approval bridge — when the caller provides a requestPermission hook, the
  // SDK pauses before each tool execution and waits for our async resolution.
  // bypassPermissions short-circuits this in the SDK, so we don't bother
  // wiring the hook when fullAccess is on.
  if (requestPermission && !runConfig.fullAccess) {
    const canUseTool: CanUseTool = async (toolName, input, ctx) => {
      const decision = await requestPermission(toolName, input, ctx.toolUseID);
      const result: PermissionResult =
        decision === "allow"
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "User denied this tool call.", interrupt: false };
      return result;
    };
    options.canUseTool = canUseTool;
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

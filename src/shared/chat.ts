import type { ProviderId } from "./providers";

export type ChatEvent =
  | { kind: "session_init"; sessionId: string; model: string; tools: string[] }
  | { kind: "assistant_text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; output: string; isError: boolean }
  | {
      kind: "result";
      subtype: "success" | "error";
      costUsd: number | null;
      turns: number;
      durationMs: number;
      errorText?: string;
    }
  | { kind: "error"; message: string };

export type ChatEventEnvelope = {
  threadId: string;
  requestId: string;
  event: ChatEvent;
};

export type RunMode = "plan" | "build" | "auto-edit" | "auto";

export type ThinkingMode = "adaptive" | "enabled" | "disabled";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type RunConfig = {
  model: string;
  fallbackModel?: string;
  mode: RunMode;
  /**
   * Distinct from `mode` so the user can pick a normal mode (plan/build/etc.)
   * and still override into bypassPermissions when they explicitly want it.
   * When true, the agent is invoked with `permissionMode: "bypassPermissions"`
   * + `allowDangerouslySkipPermissions: true`, ignoring `mode`.
   */
  fullAccess: boolean;
  effort: EffortLevel;
  thinking: ThinkingMode;
  thinkingBudget?: number;
  context1M: boolean;
};

/**
 * Min/max for the fixed-budget extended thinking option.
 *
 * Per `@anthropic-ai/sdk/resources/messages/messages.d.ts` line 969 (and the
 * mirror under `resources/beta/.../messages.d.ts` line 1433), the runtime rule
 * is: `budget_tokens >= 1024` and `budget_tokens < max_tokens`. `max_tokens`
 * varies by model and beta headers — Sonnet 4.x defaults to 64K and can reach
 * 128K with the `output-128k-2025-02-19` beta; Opus 4.7 typically tops out at
 * 64K. So the *theoretical* SDK ceiling is just under 128K. We cap the input
 * at 128_000 so users can pick anywhere in the supported range; the API will
 * reject values that exceed the chosen model's actual `max_tokens`.
 */
export const THINKING_BUDGET_MIN = 1024;
export const THINKING_BUDGET_MAX = 128_000;
export const THINKING_BUDGET_DEFAULT = 8_000;

export type SendPromptRequest = {
  /**
   * Renderer-generated request id. Required so the renderer can dispatch its
   * `begin_stream` action with the same id before awaiting this IPC, closing
   * the race where the main process emits events back faster than the
   * renderer's microtask resolves the await.
   */
  requestId: string;
  threadId: string;
  provider: ProviderId;
  prompt: string;
  cwd?: string;
  resumeSessionId?: string | null;
  runConfig: RunConfig;
};

export type SendPromptResponse =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

export type CancelPromptRequest = {
  requestId: string;
};

export type Platform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

export type EnvironmentInfo = {
  platform: Platform;
  homeDir: string;
  defaultCwd: string;
  appVersion: string;
  hasAnthropicEnvKey: boolean;
};

export type ChooseDirectoryResponse =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

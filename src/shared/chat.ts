import type { ProviderId, ProviderRuntimeSettings } from "./providers";

export type ChatEvent =
  | { kind: "session_init"; sessionId: string; model: string; tools: string[] }
  | { kind: "assistant_text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; output: string; isError: boolean }
  | {
      kind: "user_input_request";
      requestId: string;
      questions: UserInputQuestion[];
    }
  | {
      kind: "user_input_resolved";
      requestId: string;
      answers: Record<string, string[]>;
      rejected: boolean;
    }
  | {
      kind: "permission_request";
      /** Unique id used to correlate the renderer's allow/deny response. */
      permId: string;
      /** Maps to the tool_use block ID so the UI can render approval inline. */
      toolUseId: string;
      toolName: string;
      input: unknown;
      title?: string;
      description?: string;
    }
  | {
      kind: "permission_resolved";
      permId: string;
      decision: "allow" | "deny";
    }
  | {
      kind: "result";
      subtype: "success" | "error";
      costUsd: number | null;
      turns: number;
      durationMs: number;
      errorText?: string;
    }
  | { kind: "error"; message: string };

export type PermissionResponseRequest = {
  permId: string;
  decision: "allow" | "deny";
};

export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
  custom?: boolean;
};

export type UserInputResponseRequest = {
  requestId: string;
  answers: Record<string, string[]>;
  reject?: boolean;
};

export type ChatEventEnvelope = {
  threadId: string;
  requestId: string;
  event: ChatEvent;
};

export type RunMode = "plan" | "build" | "auto-edit" | "auto";

export type ThinkingMode = "adaptive" | "enabled" | "disabled";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type ServiceTier = "standard" | "fast";

export type RunConfig = {
  provider: ProviderId;
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
  /**
   * Codex-only latency tier. `standard` keeps fast mode off; `fast` maps to
   * Codex CLI's `/fast on` behavior.
   */
  serviceTier: ServiceTier;
  /**
   * OpenCode-only agent name from the local OpenCode agent catalog.
   * Undefined preserves the default OpenCode behavior; plan mode still maps
   * to the built-in plan agent when no explicit agent is selected.
   */
  opencodeAgent?: string;
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
  providerRuntime?: ProviderRuntimeSettings;
  /**
   * When true the SDK gates each tool call through `canUseTool`, which we
   * bridge to the renderer over IPC so the user can allow/deny inline. False
   * preserves the legacy auto-allow behaviour.
   */
  askBeforeTools?: boolean;
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

export type ChooseFilesRequest = {
  defaultPath?: string;
  multi?: boolean;
};

export type ChooseFilesResponse =
  | { ok: true; paths: string[] }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

export type OpenInEditorRequest = {
  /** Argv-style command. e.g. "code --wait" or just "subl". Path is appended last. */
  editorCommand: string;
  path: string;
};

export type OpenInEditorResponse =
  | { ok: true }
  | { ok: false; error: string };

export type ReadScriptsRequest = {
  projectPath: string;
};

export type ReadScriptsResponse =
  | {
      ok: true;
      manager: "bun" | "npm" | "pnpm" | "yarn";
      scripts: { name: string; command: string }[];
    }
  | { ok: false; error: string };

export type WriteProjectFileRequest = {
  projectPath: string;
  /** Relative path inside projectPath. Absolute paths and parent traversal are rejected. */
  relativePath: string;
  contents: string;
};

export type WriteProjectFileResponse =
  | { ok: true; path: string }
  | { ok: false; error: string };

export type ProjectFileSearchEntry = {
  path: string;
};

export type ProjectSearchFilesRequest = {
  projectPath: string;
  query?: string;
  limit?: number;
};

export type ProjectSearchFilesResponse =
  | {
      ok: true;
      entries: ProjectFileSearchEntry[];
      totalCount: number;
    }
  | { ok: false; error: string };

export type ProjectSkillEntry = {
  name: string;
  displayName: string;
  description?: string;
  shortDescription?: string;
  scope: "project" | "personal" | "app" | "system";
  path: string;
};

export type ProjectListSkillsRequest = {
  projectPath?: string;
};

export type ProjectListSkillsResponse =
  | { ok: true; skills: ProjectSkillEntry[] }
  | { ok: false; error: string };

export type GitStatusRequest = {
  projectPath: string;
};

export type GitStatusFile = {
  path: string;
  index: string;
  worktree: string;
};

export type GitStatusResponse =
  | {
      ok: true;
      isRepo: true;
      branch: string | null;
      upstream: string | null;
      ahead: number;
      behind: number;
      staged: number;
      unstaged: number;
      untracked: number;
      conflicted: number;
      files: GitStatusFile[];
    }
  | { ok: true; isRepo: false }
  | { ok: false; error: string };

export type GitDiffRequest = {
  projectPath: string;
  /** Relative path from the project root. Omit for the whole working tree. */
  filePath?: string;
  /** When true, pass git's whitespace-insensitive diff flag. */
  ignoreWhitespace?: boolean;
};

export type GitDiffResponse =
  | { ok: true; diff: string }
  | { ok: false; error: string };

export type GitRef = {
  name: string;
  isRemote: boolean;
  current: boolean;
  isDefault: boolean;
  worktreePath: string | null;
};

export type GitListRefsRequest = {
  projectPath: string;
  query?: string;
  limit?: number;
};

export type GitListRefsResponse =
  | {
      ok: true;
      isRepo: true;
      refs: GitRef[];
      totalCount: number;
    }
  | { ok: true; isRepo: false }
  | { ok: false; error: string };

export type GitCreateWorktreeRequest = {
  projectPath: string;
  branchName: string;
  startPoint?: string;
};

export type GitCreateWorktreeResponse =
  | { ok: true; branchName: string; worktreePath: string }
  | { ok: false; error: string };

export type GitRemoveWorktreeRequest = {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
};

export type GitRemoveWorktreeResponse =
  | { ok: true }
  | { ok: false; error: string };

export type GitSwitchRefRequest = {
  projectPath: string;
  refName: string;
};

export type GitSwitchRefResponse =
  | { ok: true; refName: string | null }
  | { ok: false; error: string };

export type GitCreateRefRequest = {
  projectPath: string;
  refName: string;
  switchRef?: boolean;
};

export type GitCreateRefResponse =
  | { ok: true; refName: string }
  | { ok: false; error: string };

export type SaveImageRequest = {
  /** Base64 payload (no data:URL prefix). */
  base64: string;
  /** File extension without the dot. e.g. "png", "jpg". */
  extension: string;
};

export type SaveImageResponse =
  | { ok: true; path: string }
  | { ok: false; error: string };

export type KeybindingsLoadResponse =
  | {
      ok: true;
      overrides: Record<string, string>;
      rules: { key: string; command: string; when?: string }[];
      path: string;
    }
  | { ok: false; error: string; path: string };

export type KeybindingsSaveRequest = {
  overrides: Record<string, string>;
  rules?: { key: string; command: string; when?: string }[];
};

export type KeybindingsSaveResponse =
  | { ok: true; path: string }
  | { ok: false; error: string };

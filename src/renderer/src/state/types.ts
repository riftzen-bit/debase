import type { ProviderId } from "@shared/providers";
import type { RunConfig, RunMode } from "@shared/chat";

export type AssistantBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool_use";
      id: string;
      name: string;
      input: unknown;
      result?: { output: string; isError: boolean };
    };

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
  createdAt: number;
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  provider?: ProviderId;
  blocks: AssistantBlock[];
  createdAt: number;
  status: "streaming" | "done" | "error";
  /**
   * Run mode that produced this message. Captured at begin_stream so the UI
   * can flag plan-mode replies even after the user has switched the mode for
   * the next turn. Optional for backward compatibility with persisted state.
   */
  mode?: RunMode;
  costUsd?: number | null;
  turns?: number;
  durationMs?: number;
  errorText?: string;
};

export type ChatMessage = UserMessage | AssistantMessage;

export type Thread = {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  sessionId: string | null;
  messages: ChatMessage[];
  runConfig: RunConfig;
  /**
   * Queued prompt typed by the user while the thread was busy. Auto-sent as
   * a normal user turn the moment the running stream finishes. Null when
   * nothing is queued.
   */
  queuedPrompt?: string | null;
  /**
   * In-progress composer text for this thread. Persisted so switching threads
   * and returning preserves the draft. Cleared on successful submit.
   */
  draft?: string | null;
  /**
   * Timestamp the thread was moved to the Archive section, or null/undefined
   * when active. Archived threads are hidden from the project listing and
   * surfaced only inside the Archive group at the bottom of the sidebar.
   * Restoring a thread sets this back to null.
   */
  archivedAt?: number | null;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  expanded: boolean;
  threads: Thread[];
};

export type AppSettings = {
  defaults: RunConfig;
  enabledProviders: Record<ProviderId, boolean>;
  /**
   * Argv-style editor command used by the "open in editor" action. Tokens are
   * split by whitespace (with quote-awareness) and the project path is
   * appended as the final argument. Empty disables the action.
   */
  editorCommand?: string;
  /**
   * When true the SDK gates every tool call through a renderer prompt. The
   * agent waits for an inline allow/deny click before each tool runs.
   * Mode = bypassPermissions (full access) short-circuits this.
   */
  askBeforeTools?: boolean;
};

export type PendingInfo = {
  requestId: string;
  threadId: string;
  assistantMsgId: string;
  startedAt: number;
};

export type PendingPermission = {
  permId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
  threadId: string;
  requestId: string;
  decision?: "allow" | "deny";
};

export type AppState = {
  projects: Project[];
  selectedProjectId: string | null;
  selectedThreadId: string | null;
  settings: AppSettings;
  /**
   * Per-thread pending stream state. Keyed by threadId so multiple threads
   * can stream simultaneously (parallel agents). A thread is "running" iff
   * `pendings[threadId]` is set.
   */
  pendings: Record<string, PendingInfo>;
  /**
   * Outstanding tool-call approvals keyed by `permId`. Populated by
   * permission_request events and consumed when the user clicks allow/deny
   * (or when the run is cancelled / completes).
   */
  pendingPermissions: Record<string, PendingPermission>;
};

export const DEFAULT_RUN_CONFIG: RunConfig = {
  provider: "claude",
  model: "claude-opus-4-7",
  mode: "build",
  fullAccess: false,
  effort: "high",
  thinking: "adaptive",
  context1M: false,
  serviceTier: "standard",
};

export const DEFAULT_SETTINGS: AppSettings = {
  defaults: DEFAULT_RUN_CONFIG,
  enabledProviders: { claude: true, codex: true, opencode: false },
  editorCommand: "",
  askBeforeTools: false,
};

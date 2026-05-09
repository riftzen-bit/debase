import type { ProviderId } from "@shared/providers";
import type { RunConfig } from "@shared/chat";

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
  blocks: AssistantBlock[];
  createdAt: number;
  status: "streaming" | "done" | "error";
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
};

export type PendingInfo = {
  requestId: string;
  threadId: string;
  assistantMsgId: string;
  startedAt: number;
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
};

export const DEFAULT_RUN_CONFIG: RunConfig = {
  model: "claude-opus-4-7",
  mode: "build",
  fullAccess: false,
  effort: "high",
  thinking: "adaptive",
  context1M: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  defaults: DEFAULT_RUN_CONFIG,
  enabledProviders: { claude: true, codex: false, opencode: false },
};

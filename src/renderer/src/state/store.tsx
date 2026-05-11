import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatEventEnvelope, RunConfig } from "@shared/chat";
import {
  EMPTY_PROVIDER_CATALOG,
  modelPreferencesForProvider,
  type ProviderCatalog,
  type ProviderModelPreferences,
  type ProviderId,
  type ProviderRuntimeConfig,
} from "@shared/providers";
import { newId } from "../lib/id";
import { load, save } from "../lib/persist";
import { truncate } from "../lib/format";
import { threadCwd } from "../lib/workdir";
import {
  DEFAULT_SETTINGS,
  type AssistantBlock,
  type AppState,
  type AssistantMessage,
  type ChatMessage,
  type PendingInfo,
  type PendingPermission,
  type Project,
  type Thread,
} from "./types";

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "new_project"; project: Project }
  | { type: "rename_project"; projectId: string; name: string }
  | { type: "delete_project"; projectId: string; cancelledThreadIds: string[] }
  | { type: "toggle_project_expanded"; projectId: string }
  | { type: "select_project"; projectId: string | null }
  | { type: "new_thread"; projectId: string; thread: Thread }
  | { type: "select_thread"; threadId: string | null }
  | { type: "delete_thread"; threadId: string }
  | { type: "rename_thread"; threadId: string; title: string }
  | { type: "set_thread_pinned"; threadId: string; pinned: boolean }
  | { type: "set_thread_archived"; threadId: string; archived: boolean }
  | { type: "set_thread_worktree"; threadId: string; worktreePath: string | null }
  | { type: "update_thread_run_config"; threadId: string; runConfig: Partial<RunConfig> }
  | { type: "update_settings_defaults"; defaults: Partial<RunConfig> }
  | { type: "update_settings_provider"; provider: ProviderId; enabled: boolean }
  | {
      type: "update_model_preferences";
      provider: ProviderId;
      preferences: Partial<ProviderModelPreferences>;
    }
  | { type: "set_editor_command"; command: string }
  | {
      type: "update_provider_runtime";
      provider: ProviderId;
      config: Partial<ProviderRuntimeConfig>;
    }
  | { type: "append_user"; threadId: string; message: ChatMessage }
  | {
      type: "begin_stream";
      threadId: string;
      requestId: string;
      assistantMsgId: string;
      placeholder: AssistantMessage;
    }
  | { type: "ipc_event"; env: ChatEventEnvelope }
  | { type: "stream_finished"; threadId: string; requestId: string }
  | { type: "fail_pending"; threadId: string; assistantMsgId: string; error: string }
  | { type: "cancel_pending"; threadId: string }
  | { type: "enqueue_prompt"; threadId: string; text: string }
  | { type: "clear_queue"; threadId: string }
  | { type: "set_thread_draft"; threadId: string; draft: string | null }
  | { type: "set_ask_before_tools"; enabled: boolean }
  | { type: "permission_pending"; permission: PendingPermission }
  | { type: "permission_resolve"; permId: string; decision: "allow" | "deny" }
  | { type: "permission_remove"; permId: string }
  | { type: "permission_clear_request"; requestId: string };

const initialState: AppState = {
  projects: [],
  selectedProjectId: null,
  selectedThreadId: null,
  settings: DEFAULT_SETTINGS,
  pendings: {},
  pendingPermissions: {},
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;

    case "new_project":
      return {
        ...state,
        projects: [action.project, ...state.projects],
        selectedProjectId: action.project.id,
        selectedThreadId: null,
      };

    case "rename_project":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, name: action.name, updatedAt: Date.now() } : p,
        ),
      };

    case "delete_project": {
      const projects = state.projects.filter((p) => p.id !== action.projectId);
      const removingActive = state.selectedProjectId === action.projectId;
      const cancelled = new Set(action.cancelledThreadIds);
      const removedThreadIds = new Set<string>(
        state.projects
          .filter((p) => p.id === action.projectId)
          .flatMap((p) => p.threads.map((t) => t.id)),
      );
      const pendings = { ...state.pendings };
      for (const id of cancelled) delete pendings[id];
      const selectedThreadGone =
        state.selectedThreadId !== null && removedThreadIds.has(state.selectedThreadId);
      return {
        ...state,
        projects,
        pendings,
        selectedProjectId:
          removingActive || selectedThreadGone
            ? projects[0]?.id ?? null
            : state.selectedProjectId,
        selectedThreadId: selectedThreadGone ? null : state.selectedThreadId,
      };
    }

    case "toggle_project_expanded":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, expanded: !p.expanded } : p,
        ),
      };

    case "select_project":
      return { ...state, selectedProjectId: action.projectId, selectedThreadId: null };

    case "new_thread":
      return {
        ...state,
        selectedProjectId: action.projectId,
        selectedThreadId: action.thread.id,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                expanded: true,
                updatedAt: Date.now(),
                threads: [action.thread, ...p.threads],
              }
            : p,
        ),
      };

    case "select_thread":
      return { ...state, selectedThreadId: action.threadId };

    case "delete_thread": {
      let containingProjectId: string | null = null;
      const projects = state.projects.map((p) => {
        if (!p.threads.some((t) => t.id === action.threadId)) return p;
        containingProjectId = p.id;
        return { ...p, threads: p.threads.filter((t) => t.id !== action.threadId) };
      });
      const pendings = { ...state.pendings };
      delete pendings[action.threadId];
      return {
        ...state,
        projects,
        pendings,
        selectedThreadId:
          state.selectedThreadId === action.threadId ? null : state.selectedThreadId,
        selectedProjectId:
          state.selectedThreadId === action.threadId
            ? containingProjectId ?? state.selectedProjectId
            : state.selectedProjectId,
      };
    }

    case "rename_thread":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          title: action.title,
          updatedAt: Date.now(),
        })),
      };

    case "set_thread_pinned":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          pinned: action.pinned,
          updatedAt: Date.now(),
        })),
      };

    case "set_thread_archived":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          archivedAt: action.archived ? Date.now() : null,
          // Archiving also unpins — pinned threads are about active work, and
          // an archived thread can't be both "tucked away" and "stuck on top".
          pinned: action.archived ? false : t.pinned,
          updatedAt: Date.now(),
        })),
      };

    case "set_thread_worktree":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          sessionId: null,
          worktreePath: action.worktreePath,
          updatedAt: Date.now(),
        })),
      };

    case "update_thread_run_config":
      // Mirror the user's choice onto `settings.defaults` so the next thread
      // they create inherits the same model/mode/effort/thinking they were
      // last using. Without this, a brand-new thread always reverts to the
      // hard-coded DEFAULT_RUN_CONFIG instead of remembering preferences.
      return {
        ...state,
        settings: {
          ...state.settings,
          defaults: { ...state.settings.defaults, ...action.runConfig },
        },
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          sessionId:
            action.runConfig.provider && action.runConfig.provider !== t.runConfig.provider
              ? null
              : t.sessionId,
          runConfig: { ...t.runConfig, ...action.runConfig },
          updatedAt: Date.now(),
        })),
      };

    case "update_settings_defaults":
      return {
        ...state,
        settings: {
          ...state.settings,
          defaults: { ...state.settings.defaults, ...action.defaults },
        },
      };

    case "update_settings_provider":
      return {
        ...state,
        settings: {
          ...state.settings,
          enabledProviders: {
            ...state.settings.enabledProviders,
            [action.provider]: action.enabled,
          },
        },
      };

    case "update_model_preferences": {
      const current = modelPreferencesForProvider(
        state.settings.modelPreferences,
        action.provider,
      );
      return {
        ...state,
        settings: {
          ...state.settings,
          modelPreferences: {
            ...state.settings.modelPreferences,
            [action.provider]: { ...current, ...action.preferences },
          },
        },
      };
    }

    case "set_editor_command":
      return {
        ...state,
        settings: { ...state.settings, editorCommand: action.command },
      };

    case "update_provider_runtime": {
      const current = state.settings.providerRuntime[action.provider] ?? {};
      return {
        ...state,
        settings: {
          ...state.settings,
          providerRuntime: {
            ...state.settings.providerRuntime,
            [action.provider]: { ...current, ...action.config },
          },
        },
      };
    }

    case "append_user":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => {
          const nextTitle =
            t.messages.length === 0 && action.message.role === "user"
              ? truncate(action.message.text, 48) || t.title
              : t.title;
          return {
            ...t,
            title: nextTitle,
            updatedAt: Date.now(),
            messages: [...t.messages, action.message],
          };
        }),
      };

    case "begin_stream":
      return {
        ...state,
        pendings: {
          ...state.pendings,
          [action.threadId]: {
            requestId: action.requestId,
            threadId: action.threadId,
            assistantMsgId: action.assistantMsgId,
            startedAt: Date.now(),
          },
        },
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          updatedAt: Date.now(),
          messages: [...t.messages, action.placeholder],
        })),
      };

    case "ipc_event":
      return applyEvent(state, action.env);

    case "stream_finished": {
      const current = state.pendings[action.threadId];
      // Stale-run guard: only finalise if the requestId still matches. This
      // prevents a `result` envelope from a cancelled run wiping the new
      // pending slot that Send-Now just installed.
      if (!current || current.requestId !== action.requestId) return state;
      const pendings = { ...state.pendings };
      delete pendings[action.threadId];
      return { ...state, pendings };
    }

    case "fail_pending": {
      const pendings = { ...state.pendings };
      delete pendings[action.threadId];
      return {
        ...state,
        pendings,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.role === "assistant" && m.id === action.assistantMsgId
              ? { ...m, status: "error" as const, errorText: action.error }
              : m,
          ),
        })),
      };
    }

    case "cancel_pending": {
      const pending = state.pendings[action.threadId];
      if (!pending) return state;
      const pendings = { ...state.pendings };
      delete pendings[action.threadId];
      return {
        ...state,
        pendings,
        projects: mapThread(state.projects, pending.threadId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.role === "assistant" && m.id === pending.assistantMsgId && m.status === "streaming"
              ? { ...m, status: "error" as const, errorText: "Cancelled." }
              : m,
          ),
        })),
      };
    }

    case "enqueue_prompt":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          queuedPrompt: action.text,
        })),
      };

    case "clear_queue":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          queuedPrompt: null,
        })),
      };

    case "set_thread_draft":
      return {
        ...state,
        projects: mapThread(state.projects, action.threadId, (t) => ({
          ...t,
          draft: action.draft,
        })),
      };

    case "set_ask_before_tools":
      return {
        ...state,
        settings: { ...state.settings, askBeforeTools: action.enabled },
      };

    case "permission_pending":
      return {
        ...state,
        pendingPermissions: {
          ...state.pendingPermissions,
          [action.permission.permId]: action.permission,
        },
      };

    case "permission_resolve": {
      const existing = state.pendingPermissions[action.permId];
      if (!existing) return state;
      // Keep the entry briefly with the decision so the UI can flash a
      // confirmed state before unmounting.
      return {
        ...state,
        pendingPermissions: {
          ...state.pendingPermissions,
          [action.permId]: { ...existing, decision: action.decision },
        },
      };
    }

    case "permission_remove": {
      if (!(action.permId in state.pendingPermissions)) return state;
      const next = { ...state.pendingPermissions };
      delete next[action.permId];
      return { ...state, pendingPermissions: next };
    }

    case "permission_clear_request": {
      const next: typeof state.pendingPermissions = {};
      for (const [permId, perm] of Object.entries(state.pendingPermissions)) {
        if (perm.requestId !== action.requestId) next[permId] = perm;
      }
      return { ...state, pendingPermissions: next };
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

function mapThread(
  projects: Project[],
  threadId: string,
  fn: (t: Thread) => Thread,
): Project[] {
  return projects.map((p) => {
    if (!p.threads.some((t) => t.id === threadId)) return p;
    return {
      ...p,
      threads: p.threads.map((t) => (t.id === threadId ? fn(t) : t)),
    };
  });
}

function applyEvent(state: AppState, envelope: ChatEventEnvelope): AppState {
  const { threadId, requestId, event } = envelope;
  const pending = state.pendings[threadId];
  // Drop events from a stale run. After Send-Now (cancel + re-send), the SDK
  // can still emit a queued chunk from the cancelled run *after* the renderer
  // has committed begin_stream for the new run; without this guard those
  // chunks would be appended to the new placeholder.
  if (!pending || pending.requestId !== requestId) return state;

  return {
    ...state,
    projects: mapThread(state.projects, threadId, (t) => ({
      ...t,
      sessionId: event.kind === "session_init" ? event.sessionId : t.sessionId,
      updatedAt: Date.now(),
      messages: t.messages.map((m) =>
        m.role === "assistant" && m.id === pending.assistantMsgId
          ? mutateAssistant(m, event)
          : m,
      ),
    })),
  };
}

function mutateAssistant(
  msg: AssistantMessage,
  event: ChatEventEnvelope["event"],
): AssistantMessage {
  switch (event.kind) {
    case "session_init":
      return msg;
    case "assistant_text":
      return {
        ...msg,
        blocks: appendAssistantBlock(msg.blocks, { kind: "text", text: event.text }),
      };
    case "thinking":
      return {
        ...msg,
        blocks: appendAssistantBlock(msg.blocks, { kind: "thinking", text: event.text }),
      };
    case "tool_use":
      return {
        ...msg,
        blocks: [
          ...msg.blocks,
          {
            kind: "tool_use",
            id: event.id,
            name: event.name,
            input: event.input,
          },
        ],
      };
    case "tool_result":
      return {
        ...msg,
        blocks: msg.blocks.map((b) =>
          b.kind === "tool_use" && b.id === event.toolUseId
            ? { ...b, result: { output: event.output, isError: event.isError } }
            : b,
        ),
      };
    case "user_input_request":
      return {
        ...msg,
        blocks: [
          ...msg.blocks,
          {
            kind: "user_input",
            requestId: event.requestId,
            questions: event.questions,
          },
        ],
      };
    case "user_input_resolved":
      return {
        ...msg,
        blocks: msg.blocks.map((b) =>
          b.kind === "user_input" && b.requestId === event.requestId
            ? { ...b, answers: event.answers, rejected: event.rejected }
            : b,
        ),
      };
    case "result":
      return {
        ...msg,
        status: event.subtype === "success" ? "done" : "error",
        costUsd: event.costUsd,
        turns: event.turns,
        durationMs: event.durationMs,
        errorText: event.errorText,
      };
    case "error":
      return {
        ...msg,
        status: "error",
        errorText: event.message,
      };
    default:
      return msg;
  }
}

function appendAssistantBlock(
  blocks: AssistantMessage["blocks"],
  block: Extract<AssistantBlock, { kind: "text" | "thinking" }>,
): AssistantMessage["blocks"] {
  if (block.text.length === 0) return blocks;
  const previous = blocks[blocks.length - 1];
  if (isAppendableTextBlock(previous) && previous.kind === block.kind) {
    return [
      ...blocks.slice(0, -1),
      { ...previous, text: previous.text + block.text },
    ];
  }
  return [...blocks, block];
}

function isAppendableTextBlock(
  block: AssistantBlock | undefined,
): block is Extract<AssistantBlock, { kind: "text" | "thinking" }> {
  return block?.kind === "text" || block?.kind === "thinking";
}

type StoreContext = {
  state: AppState;
  providerCatalog: ProviderCatalog;
  refreshProviderCatalog: () => Promise<void>;
  newProject: (name: string, path: string) => void;
  renameProject: (projectId: string, name: string) => void;
  deleteProject: (projectId: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  selectProject: (projectId: string | null) => void;
  newThread: (projectId: string) => void;
  selectThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void;
  setThreadPinned: (threadId: string, pinned: boolean) => void;
  setThreadArchived: (threadId: string, archived: boolean) => void;
  setThreadWorktree: (threadId: string, worktreePath: string | null) => void;
  updateThreadRunConfig: (threadId: string, runConfig: Partial<RunConfig>) => void;
  updateDefaultRunConfig: (defaults: Partial<RunConfig>) => void;
  setProviderEnabled: (provider: ProviderId, enabled: boolean) => void;
  updateModelPreferences: (
    provider: ProviderId,
    preferences: Partial<ProviderModelPreferences>,
  ) => void;
  setEditorCommand: (command: string) => void;
  updateProviderRuntime: (
    provider: ProviderId,
    config: Partial<ProviderRuntimeConfig>,
  ) => void;
  setAskBeforeTools: (enabled: boolean) => void;
  respondToPermission: (permId: string, decision: "allow" | "deny") => Promise<void>;
  respondToUserInput: (
    requestId: string,
    answers: Record<string, string[]>,
    reject?: boolean,
  ) => Promise<void>;
  /**
   * Send a prompt on the given thread (defaults to selectedThreadId). Returns
   * a status string so the caller knows whether to drop the draft or restore
   * it. The render-side requestId is generated up front so the store can
   * dispatch begin_stream before the IPC await — events from the SDK can no
   * longer race ahead of the pending state.
   */
  sendPrompt: (text: string, threadId?: string) => Promise<"sent" | "blocked" | "failed">;
  /**
   * Cancel the running stream on `threadId` and immediately send `text` as a
   * new user turn. Session resume preserves conversation context. Use when
   * the user wants to interrupt and redirect mid-task.
   */
  sendNow: (text: string, threadId?: string) => Promise<"sent" | "blocked" | "failed">;
  /**
   * Save `text` for a thread that is currently busy. The auto-flush effect
   * picks it up and dispatches a normal `sendPrompt` the moment the active
   * stream resolves. Overwrites any earlier queued prompt for that thread.
   */
  enqueuePrompt: (text: string, threadId?: string) => void;
  clearQueue: (threadId: string) => void;
  cancelPrompt: (threadId?: string) => Promise<void>;
  setThreadDraft: (threadId: string, draft: string | null) => void;
};

const Ctx = createContext<StoreContext | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>(
    EMPTY_PROVIDER_CATALOG,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  // Without this guard, the very first render would write the empty
  // `initialState` to localStorage *before* hydrate's queued state update
  // is applied — briefly stomping on the user's persisted settings/projects.
  // Using state (not a ref) is deliberate: we need the effect deps to
  // re-fire after hydrate so the persisted state actually round-trips.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persisted = load();
    if (persisted) {
      dispatch({ type: "hydrate", state: persisted });
    }
    setHydrated(true);
    // Tell main about the project paths the renderer has on disk so they
    // pass the cwd allowlist check on first send. Idempotent in main —
    // only honoured once per launch, so a later renderer compromise can't
    // smuggle additional roots in without going through chooseDirectory.
    const rootPaths = (persisted?.projects ?? [])
      .flatMap((p) => [
        p.path,
        ...p.threads.map((t) => t.worktreePath ?? ""),
      ])
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    void window.api.project.bootstrapAllowlist(rootPaths);
  }, []);

  const refreshProviderCatalog = useCallback(async () => {
    const response = await window.api.providers.list({
      runtime: stateRef.current.settings.providerRuntime,
    });
    setProviderCatalog(response.catalog);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refreshProviderCatalog();
  }, [hydrated, refreshProviderCatalog]);

  useEffect(() => {
    if (!hydrated) return;
    save(state);
  }, [state, hydrated]);

  useEffect(() => {
    const off = window.api.chat.onEvent((env) => {
      // Permission events are out-of-band — they don't mutate the assistant
      // message stream, so route them straight to the dedicated reducer
      // cases instead of through `ipc_event`.
      if (env.event.kind === "permission_request") {
        dispatch({
          type: "permission_pending",
          permission: {
            permId: env.event.permId,
            toolUseId: env.event.toolUseId,
            toolName: env.event.toolName,
            input: env.event.input,
            threadId: env.threadId,
            requestId: env.requestId,
          },
        });
        return;
      }
      if (env.event.kind === "permission_resolved") {
        dispatch({
          type: "permission_resolve",
          permId: env.event.permId,
          decision: env.event.decision,
        });
        return;
      }

      dispatch({ type: "ipc_event", env });
      if (env.event.kind === "result" || env.event.kind === "error") {
        // Same stale-run guard as applyEvent: only finalise if the envelope's
        // requestId still matches the active pending. The reducer enforces
        // this; we read the latest snapshot via stateRef to avoid dispatching
        // a no-op when a Send-Now race has already replaced the pending slot.
        const pending = stateRef.current.pendings[env.threadId];
        if (pending && pending.requestId === env.requestId) {
          dispatch({
            type: "stream_finished",
            threadId: env.threadId,
            requestId: env.requestId,
          });
          // Pending approvals from a finished run are stale — drop them so
          // the UI never shows orphaned allow/deny cards.
          dispatch({ type: "permission_clear_request", requestId: env.requestId });
        }
      }
    });
    return off;
  }, []);

  const newProject = useCallback((name: string, path: string) => {
    const project: Project = {
      id: newId("prj"),
      name: name.trim() || derivedNameFromPath(path) || "Untitled project",
      path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expanded: true,
      threads: [],
    };
    dispatch({ type: "new_project", project });
  }, []);

  const renameProject = useCallback((projectId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch({ type: "rename_project", projectId, name: trimmed });
  }, []);

  const deleteProject = useCallback((projectId: string) => {
    const project = stateRef.current.projects.find((p) => p.id === projectId);
    const threadIds = project?.threads.map((t) => t.id) ?? [];
    // Cancel any in-flight stream on those threads BEFORE the reducer drops
    // them — otherwise the main process keeps running and orphaned events
    // arrive after the threads are gone.
    const pendings = stateRef.current.pendings;
    const cancelled: string[] = [];
    for (const id of threadIds) {
      const p = pendings[id];
      if (p) {
        cancelled.push(id);
        void window.api.chat.cancel({ requestId: p.requestId });
      }
    }
    dispatch({ type: "delete_project", projectId, cancelledThreadIds: cancelled });
  }, []);

  const toggleProjectExpanded = useCallback((projectId: string) => {
    dispatch({ type: "toggle_project_expanded", projectId });
  }, []);

  const selectProject = useCallback((projectId: string | null) => {
    dispatch({ type: "select_project", projectId });
  }, []);

  const newThread = useCallback((projectId: string) => {
    const project = stateRef.current.projects.find((p) => p.id === projectId);
    if (!project) return;
    const now = Date.now();
    const thread: Thread = {
      id: newId("th"),
      title: "New conversation",
      pinned: false,
      createdAt: now,
      updatedAt: now,
      sessionId: null,
      worktreePath: null,
      runConfig: { ...stateRef.current.settings.defaults },
      messages: [],
    };
    dispatch({ type: "new_thread", projectId, thread });
  }, []);

  const selectThread = useCallback((id: string) => {
    dispatch({ type: "select_thread", threadId: id });
  }, []);

  const deleteThread = useCallback((id: string) => {
    const p = stateRef.current.pendings[id];
    if (p) {
      void window.api.chat.cancel({ requestId: p.requestId });
    }
    dispatch({ type: "delete_thread", threadId: id });
  }, []);

  const renameThread = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    dispatch({ type: "rename_thread", threadId: id, title: trimmed });
  }, []);

  const setThreadPinned = useCallback((id: string, pinned: boolean) => {
    dispatch({ type: "set_thread_pinned", threadId: id, pinned });
  }, []);

  const setThreadArchived = useCallback((id: string, archived: boolean) => {
    // Archiving a running thread would orphan its in-flight stream — cancel
    // the pending request first so the main process tears down cleanly.
    if (archived) {
      const p = stateRef.current.pendings[id];
      if (p) void window.api.chat.cancel({ requestId: p.requestId });
    }
    dispatch({ type: "set_thread_archived", threadId: id, archived });
  }, []);

  const setThreadWorktree = useCallback((id: string, worktreePath: string | null) => {
    dispatch({ type: "set_thread_worktree", threadId: id, worktreePath });
  }, []);

  const updateThreadRunConfig = useCallback(
    (id: string, runConfig: Partial<RunConfig>) => {
      dispatch({ type: "update_thread_run_config", threadId: id, runConfig });
    },
    [],
  );

  const updateDefaultRunConfig = useCallback((defaults: Partial<RunConfig>) => {
    dispatch({ type: "update_settings_defaults", defaults });
  }, []);

  const setProviderEnabled = useCallback((provider: ProviderId, enabled: boolean) => {
    dispatch({ type: "update_settings_provider", provider, enabled });
  }, []);

  const updateModelPreferences = useCallback(
    (provider: ProviderId, preferences: Partial<ProviderModelPreferences>) => {
      dispatch({ type: "update_model_preferences", provider, preferences });
    },
    [],
  );

  const setEditorCommand = useCallback((command: string) => {
    dispatch({ type: "set_editor_command", command });
  }, []);

  const updateProviderRuntime = useCallback(
    (provider: ProviderId, config: Partial<ProviderRuntimeConfig>) => {
      dispatch({ type: "update_provider_runtime", provider, config });
    },
    [],
  );

  const setAskBeforeTools = useCallback((enabled: boolean) => {
    dispatch({ type: "set_ask_before_tools", enabled });
  }, []);

  const respondToPermission = useCallback(
    async (permId: string, decision: "allow" | "deny") => {
      // Optimistically mark the local card as resolved; the main process
      // also broadcasts a permission_resolved event but that round-trip
      // adds a perceptible delay if the SDK is busy.
      dispatch({ type: "permission_resolve", permId, decision });
      await window.api.chat.respondToPermission({ permId, decision });
      // Drop the entry shortly after — keeping it visible for ~600ms gives
      // the user a beat to see "allowed"/"denied" before it disappears.
      window.setTimeout(() => {
        dispatch({ type: "permission_remove", permId });
      }, 600);
    },
    [],
  );

  const respondToUserInput = useCallback(
    async (
      requestId: string,
      answers: Record<string, string[]>,
      reject?: boolean,
    ) => {
      await window.api.chat.respondToUserInput({ requestId, answers, reject });
    },
    [],
  );

  /**
   * Core send: append user message, dispatch begin_stream, fire IPC. Caller
   * is responsible for the pending guard. Used by both sendPrompt (with
   * guard) and sendNow (which has just cancelled, so guard would race).
   */
  const performSend = useCallback(
    async (text: string, threadId: string): Promise<"sent" | "blocked" | "failed"> => {
      const project = stateRef.current.projects.find((p) =>
        p.threads.some((t) => t.id === threadId),
      );
      const thread = project?.threads.find((t) => t.id === threadId);
      if (!project || !thread) return "blocked";

      const userMsg: ChatMessage = {
        id: newId("msg"),
        role: "user",
        text,
        createdAt: Date.now(),
      };
      dispatch({ type: "append_user", threadId, message: userMsg });

      const assistantMsgId = newId("msg");
      const requestId = newId("req");
      const placeholder: AssistantMessage = {
        id: assistantMsgId,
        role: "assistant",
        provider: thread.runConfig.provider,
        blocks: [],
        createdAt: Date.now(),
        status: "streaming",
        mode: thread.runConfig.mode,
      };

      // Dispatch begin_stream BEFORE awaiting the IPC so any incoming events
      // find the pending state already in place. Race fix.
      dispatch({
        type: "begin_stream",
        threadId,
        requestId,
        assistantMsgId,
        placeholder,
      });

      try {
        const resp = await window.api.chat.send({
          requestId,
          threadId,
          provider: thread.runConfig.provider,
          prompt: text,
          cwd: threadCwd(project, thread) || undefined,
          resumeSessionId: thread.sessionId,
          runConfig: thread.runConfig,
          providerRuntime: stateRef.current.settings.providerRuntime,
          askBeforeTools:
            stateRef.current.settings.askBeforeTools === true && !thread.runConfig.fullAccess,
        });
        if (!resp.ok) {
          dispatch({
            type: "fail_pending",
            threadId,
            assistantMsgId,
            error: resp.error,
          });
          return "failed";
        }
        return "sent";
      } catch (err) {
        dispatch({
          type: "fail_pending",
          threadId,
          assistantMsgId,
          error: err instanceof Error ? err.message : String(err),
        });
        return "failed";
      }
    },
    [],
  );

  const sendPrompt = useCallback(
    async (text: string, explicitThreadId?: string): Promise<"sent" | "blocked" | "failed"> => {
      const trimmed = text.trim();
      if (!trimmed) return "blocked";
      const threadId = explicitThreadId ?? stateRef.current.selectedThreadId;
      if (!threadId) return "blocked";
      if (stateRef.current.pendings[threadId]) return "blocked";
      return performSend(trimmed, threadId);
    },
    [performSend],
  );

  const cancelPrompt = useCallback(async (explicitThreadId?: string) => {
    const threadId = explicitThreadId ?? stateRef.current.selectedThreadId;
    if (!threadId) return;
    const pending = stateRef.current.pendings[threadId];
    if (!pending) return;
    await window.api.chat.cancel({ requestId: pending.requestId });
    dispatch({ type: "cancel_pending", threadId });
    dispatch({ type: "permission_clear_request", requestId: pending.requestId });
  }, []);

  const enqueuePrompt = useCallback((text: string, explicitThreadId?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const threadId = explicitThreadId ?? stateRef.current.selectedThreadId;
    if (!threadId) return;
    dispatch({ type: "enqueue_prompt", threadId, text: trimmed });
  }, []);

  const clearQueue = useCallback((threadId: string) => {
    dispatch({ type: "clear_queue", threadId });
  }, []);

  const setThreadDraft = useCallback((threadId: string, draft: string | null) => {
    dispatch({ type: "set_thread_draft", threadId, draft });
  }, []);

  const sendNow = useCallback(
    async (text: string, explicitThreadId?: string): Promise<"sent" | "blocked" | "failed"> => {
      const trimmed = text.trim();
      if (!trimmed) return "blocked";
      const threadId = explicitThreadId ?? stateRef.current.selectedThreadId;
      if (!threadId) return "blocked";

      const pending = stateRef.current.pendings[threadId];
      if (pending) {
        // Cancel the running stream so the SDK session frees up. The cancel
        // dispatch + the upcoming append_user/begin_stream from performSend
        // are batched by React into a single render — the cancelled message,
        // the new user turn, and the new streaming placeholder all land
        // together. We bypass `sendPrompt`'s pending guard because the
        // stateRef hasn't been updated yet at this point in the microtask.
        await window.api.chat.cancel({ requestId: pending.requestId });
        dispatch({ type: "cancel_pending", threadId });
      }
      return performSend(trimmed, threadId);
    },
    [performSend],
  );

  // Auto-flush queued prompts: when a thread leaves the pendings map and has
  // a `queuedPrompt`, send it as a normal user turn.
  useEffect(() => {
    for (const project of state.projects) {
      for (const thread of project.threads) {
        if (thread.queuedPrompt && !state.pendings[thread.id]) {
          const queued = thread.queuedPrompt;
          // Clear the slot first to prevent the effect from looping.
          dispatch({ type: "clear_queue", threadId: thread.id });
          void sendPrompt(queued, thread.id);
        }
      }
    }
  }, [state.pendings, state.projects, sendPrompt]);

  const value = useMemo<StoreContext>(
    () => ({
      state,
      providerCatalog,
      refreshProviderCatalog,
      newProject,
      renameProject,
      deleteProject,
      toggleProjectExpanded,
      selectProject,
      newThread,
      selectThread,
      deleteThread,
      renameThread,
      setThreadPinned,
      setThreadArchived,
      setThreadWorktree,
      updateThreadRunConfig,
      updateDefaultRunConfig,
      setProviderEnabled,
      updateModelPreferences,
      setEditorCommand,
      updateProviderRuntime,
      setAskBeforeTools,
      respondToPermission,
      respondToUserInput,
      sendPrompt,
      sendNow,
      enqueuePrompt,
      clearQueue,
      cancelPrompt,
      setThreadDraft,
    }),
    [
      state,
      providerCatalog,
      refreshProviderCatalog,
      newProject,
      renameProject,
      deleteProject,
      toggleProjectExpanded,
      selectProject,
      newThread,
      selectThread,
      deleteThread,
      renameThread,
      setThreadPinned,
      setThreadArchived,
      setThreadWorktree,
      updateThreadRunConfig,
      updateDefaultRunConfig,
      setProviderEnabled,
      updateModelPreferences,
      setEditorCommand,
      updateProviderRuntime,
      setAskBeforeTools,
      respondToPermission,
      respondToUserInput,
      sendPrompt,
      sendNow,
      enqueuePrompt,
      clearQueue,
      cancelPrompt,
      setThreadDraft,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be inside <StoreProvider>");
  return ctx;
}

export function useActiveThread() {
  const { state } = useStore();
  if (!state.selectedThreadId) return null;
  for (const p of state.projects) {
    const t = p.threads.find((t) => t.id === state.selectedThreadId);
    if (t) return { project: p, thread: t };
  }
  return null;
}

export function useActiveProject() {
  const { state } = useStore();
  if (!state.selectedProjectId) return null;
  return state.projects.find((p) => p.id === state.selectedProjectId) ?? null;
}

export function isThreadPending(state: AppState, threadId: string | null): PendingInfo | null {
  if (!threadId) return null;
  return state.pendings[threadId] ?? null;
}

function derivedNameFromPath(path: string): string {
  if (!path) return "";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

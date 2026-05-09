import {
  DEFAULT_RUN_CONFIG,
  DEFAULT_SETTINGS,
  type AppState,
  type Project,
  type Thread,
} from "../state/types";
import { newId } from "./id";

const KEY_V1 = "debase.state.v1";
const KEY_V2 = "debase.state.v2";

export function load(): AppState | null {
  try {
    const v2raw = localStorage.getItem(KEY_V2);
    if (v2raw) {
      const parsed = JSON.parse(v2raw) as Partial<AppState>;
      return reconcile(parsed);
    }
    const v1raw = localStorage.getItem(KEY_V1);
    if (v1raw) {
      const migrated = migrateFromV1(JSON.parse(v1raw));
      save(migrated);
      // Only clear v1 once v2 has been written successfully — otherwise a
      // failed save (quota / disabled storage) would silently lose data.
      if (localStorage.getItem(KEY_V2)) {
        try {
          localStorage.removeItem(KEY_V1);
        } catch {
          // Removing the legacy key is best-effort.
        }
      }
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

export function save(value: AppState): void {
  try {
    // Pending is in-flight runtime state — never persist it.
    localStorage.setItem(KEY_V2, JSON.stringify({ ...value, pendings: {} }));
  } catch {
    // localStorage full / disabled — swallow.
  }
}

function reconcile(parsed: Partial<AppState>): AppState {
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  return {
    projects: projects.map(repairProject),
    selectedProjectId: typeof parsed.selectedProjectId === "string" ? parsed.selectedProjectId : null,
    selectedThreadId: typeof parsed.selectedThreadId === "string" ? parsed.selectedThreadId : null,
    settings: {
      defaults: { ...DEFAULT_RUN_CONFIG, ...(parsed.settings?.defaults ?? {}) },
      enabledProviders: {
        ...DEFAULT_SETTINGS.enabledProviders,
        ...(parsed.settings?.enabledProviders ?? {}),
      },
    },
    pendings: {},
  };
}

function repairProject(raw: unknown): Project {
  const p = raw as Project;
  return {
    id: p.id ?? newId("prj"),
    name: p.name ?? "Untitled project",
    path: p.path ?? "",
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
    expanded: p.expanded ?? true,
    threads: Array.isArray(p.threads) ? p.threads.map(repairThread) : [],
  };
}

function repairThread(raw: unknown): Thread {
  const t = raw as Thread;
  const incoming = (t.runConfig ?? {}) as Partial<Thread["runConfig"]>;
  // Earlier builds carried mode='full-access'. Migrate it onto the new
  // RunConfig.fullAccess flag so the mode picker stays clean.
  const legacyMode = (incoming as { mode?: string }).mode;
  const isLegacyFullAccess = legacyMode === "full-access";
  const mode: Thread["runConfig"]["mode"] = isLegacyFullAccess
    ? "build"
    : ((legacyMode as Thread["runConfig"]["mode"] | undefined) ?? DEFAULT_RUN_CONFIG.mode);
  const fullAccess = isLegacyFullAccess || (incoming.fullAccess ?? false);
  return {
    id: t.id ?? newId("th"),
    title: t.title ?? "Untitled",
    pinned: Boolean(t.pinned),
    createdAt: t.createdAt ?? Date.now(),
    updatedAt: t.updatedAt ?? Date.now(),
    sessionId: t.sessionId ?? null,
    archivedAt: typeof t.archivedAt === "number" ? t.archivedAt : null,
    runConfig: {
      ...DEFAULT_RUN_CONFIG,
      ...incoming,
      mode,
      fullAccess,
    },
    messages: Array.isArray(t.messages)
      ? t.messages.map((m) => {
          if (m.role === "assistant" && m.status === "streaming") {
            return {
              ...m,
              status: "error" as const,
              errorText: m.errorText ?? "Interrupted before finishing.",
            };
          }
          return m;
        })
      : [],
  };
}

type V1Thread = {
  id: string;
  title: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  sessionId: string | null;
  messages: unknown[];
};

type V1State = {
  threads?: V1Thread[];
};

function migrateFromV1(v1: V1State): AppState {
  const v1threads = Array.isArray(v1.threads) ? v1.threads : [];
  if (v1threads.length === 0) {
    return {
      projects: [],
      selectedProjectId: null,
      selectedThreadId: null,
      settings: DEFAULT_SETTINGS,
      pendings: {},
    };
  }
  const project: Project = {
    id: newId("prj"),
    name: "Imported",
    path: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expanded: true,
    threads: v1threads.map(
      (t) =>
        ({
          id: t.id,
          title: t.title || "Untitled",
          pinned: false,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          sessionId: t.sessionId,
          archivedAt: null,
          runConfig: DEFAULT_RUN_CONFIG,
          // Same streaming->error repair as repairThread. Without this the v1
          // migration path returns directly from load() and the next render
          // shows a permanently-spinning assistant turn for any thread that
          // was killed mid-stream before the upgrade.
          messages: Array.isArray(t.messages)
            ? (t.messages as Thread["messages"]).map((m) =>
                m.role === "assistant" && m.status === "streaming"
                  ? {
                      ...m,
                      status: "error" as const,
                      errorText: m.errorText ?? "Interrupted before finishing.",
                    }
                  : m,
              )
            : [],
        }) as Thread,
    ),
  };
  return {
    projects: [project],
    selectedProjectId: project.id,
    selectedThreadId: project.threads[0]?.id ?? null,
    settings: DEFAULT_SETTINGS,
    pendings: {},
  };
}

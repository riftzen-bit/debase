import {
  DEFAULT_RUN_CONFIG,
  DEFAULT_SETTINGS,
  type AppState,
  type Project,
  type Thread,
} from "../state/types";
import type { ServiceTier } from "@shared/chat";
import {
  DEFAULT_PROVIDER_RUNTIME_SETTINGS,
  defaultModelForProvider,
  findModel,
  isReadyProvider,
  modelPreferencesForProvider,
  PROVIDERS,
  type ModelPreferencesByProvider,
  type ProviderId,
  type ProviderRuntimeSettings,
} from "@shared/providers";
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
    // Pending streams + pending approvals are in-flight runtime state — never
    // persist them; reloading the app would otherwise resurrect ghost cards.
    localStorage.setItem(
      KEY_V2,
      JSON.stringify({ ...value, pendings: {}, pendingPermissions: {} }),
    );
  } catch {
    // localStorage full / disabled — swallow.
  }
}

function reconcile(parsed: Partial<AppState>): AppState {
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  const settings: AppState["settings"] = {
    defaults: repairRunConfig(
      parsed.settings?.defaults,
      repairModelPreferences(parsed.settings?.modelPreferences),
    ),
    enabledProviders: {
      ...DEFAULT_SETTINGS.enabledProviders,
      ...(parsed.settings?.enabledProviders ?? {}),
    },
    modelPreferences: repairModelPreferences(parsed.settings?.modelPreferences),
    providerRuntime: repairProviderRuntime(parsed.settings?.providerRuntime),
    editorCommand:
      typeof parsed.settings?.editorCommand === "string"
        ? parsed.settings.editorCommand
        : DEFAULT_SETTINGS.editorCommand,
    askBeforeTools:
      typeof parsed.settings?.askBeforeTools === "boolean"
        ? parsed.settings.askBeforeTools
        : DEFAULT_SETTINGS.askBeforeTools,
  };
  return {
    projects: projects.map((project) => repairProject(project, settings.modelPreferences)),
    selectedProjectId: typeof parsed.selectedProjectId === "string" ? parsed.selectedProjectId : null,
    selectedThreadId: typeof parsed.selectedThreadId === "string" ? parsed.selectedThreadId : null,
    settings,
    pendings: {},
    pendingPermissions: {},
  };
}

function repairProviderRuntime(raw: unknown): ProviderRuntimeSettings {
  const incoming = (raw ?? {}) as ProviderRuntimeSettings;
  const out: ProviderRuntimeSettings = {};
  for (const provider of PROVIDERS) {
    const defaults = DEFAULT_PROVIDER_RUNTIME_SETTINGS[provider] ?? {};
    const value = incoming[provider] ?? {};
    out[provider] = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(value).filter(([, entry]) => typeof entry === "string"),
      ),
    };
  }
  return out;
}

function repairModelPreferences(raw: unknown): ModelPreferencesByProvider {
  const incoming = (raw ?? {}) as ModelPreferencesByProvider;
  const out: ModelPreferencesByProvider = {};
  for (const provider of PROVIDERS) {
    const prefs = modelPreferencesForProvider(incoming, provider);
    if (
      prefs.favoriteModels.length === 0 &&
      prefs.hiddenModels.length === 0 &&
      prefs.customModels.length === 0
    ) {
      continue;
    }
    out[provider] =
      provider === "opencode" || provider === "cursor"
        ? { ...prefs, customModels: [] }
        : prefs;
  }
  return out;
}

function repairProject(raw: unknown, preferences?: ModelPreferencesByProvider): Project {
  const p = raw as Project;
  return {
    id: p.id ?? newId("prj"),
    name: p.name ?? "Untitled project",
    path: p.path ?? "",
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
    expanded: p.expanded ?? true,
    threads: Array.isArray(p.threads) ? p.threads.map((thread) => repairThread(thread, preferences)) : [],
  };
}

function repairThread(raw: unknown, preferences?: ModelPreferencesByProvider): Thread {
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
    worktreePath: typeof t.worktreePath === "string" ? t.worktreePath : null,
    archivedAt: typeof t.archivedAt === "number" ? t.archivedAt : null,
    runConfig: repairRunConfig({ ...incoming, mode, fullAccess }, preferences),
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

function repairRunConfig(
  raw: unknown,
  preferences?: ModelPreferencesByProvider,
): Thread["runConfig"] {
  const incoming = (raw ?? {}) as Partial<Thread["runConfig"]>;
  const model =
    typeof incoming.model === "string" ? findModel(incoming.model, undefined, preferences) : undefined;
  const provider =
    typeof incoming.provider === "string" && isReadyProvider(incoming.provider as ProviderId)
      ? (incoming.provider as ProviderId)
      : (model?.provider ?? DEFAULT_RUN_CONFIG.provider);
  const fallbackModel = defaultModelForProvider(provider, undefined, preferences);
  const nextModel =
    model?.provider === provider
      ? model.value
      : provider === "opencode" && typeof incoming.model === "string"
        ? incoming.model
        : fallbackModel.value;
  const serviceTier: ServiceTier = incoming.serviceTier === "fast" ? "fast" : "standard";
  return {
    ...DEFAULT_RUN_CONFIG,
    ...incoming,
    provider,
    model: nextModel,
    serviceTier,
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
      pendingPermissions: {},
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
          worktreePath: null,
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
    pendingPermissions: {},
  };
}

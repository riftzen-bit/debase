import type { EffortLevel } from "./chat";

export const PROVIDERS = ["claude", "codex", "opencode", "cursor"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  shortLabel: string;
  status: "ready" | "detected" | "planned";
  description: string;
};

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    shortLabel: "claude",
    status: "ready",
    description: "Anthropic Claude via @anthropic-ai/claude-agent-sdk.",
  },
  codex: {
    id: "codex",
    label: "OpenAI Codex",
    shortLabel: "codex",
    status: "ready",
    description: "OpenAI Codex CLI using the user's existing Codex login.",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "opencode",
    status: "detected",
    description: "Shown only when the local opencode CLI reports connected providers.",
  },
  cursor: {
    id: "cursor",
    label: "Cursor CLI",
    shortLabel: "cursor",
    status: "detected",
    description: "Shown only when the local Cursor CLI agent command is installed and authenticated.",
  },
};

export function isReadyProvider(id: ProviderId): boolean {
  return PROVIDER_META[id].status === "ready" || PROVIDER_META[id].status === "detected";
}

/**
 * Local mirror of the SDK's `ModelInfo` shape (sdk.d.ts ~line 1080) plus a
 * couple of extra fields we need for UX. The static fallback below is what we
 * show before the first session_init runs; once the agent reports its actual
 * `models: ModelInfo[]` we can swap in dynamic data.
 *
 * Effort-level mapping rules (per @anthropic-ai/claude-agent-sdk sdk.d.ts
 * lines 1404–1428):
 *   - low / medium / high — universal
 *   - xhigh                — Opus 4.7 only
 *   - max                  — Opus 4.6, Opus 4.7, Sonnet 4.6
 */
export type ModelInfo = {
  /** Model identifier passed to SDK Options.model. */
  value: string;
  provider: ProviderId;
  displayName: string;
  description: string;
  context: number;
  supportsEffort: boolean;
  supportedEffortLevels: EffortLevel[];
  supportsAdaptiveThinking: boolean;
};

export type OpenCodeAgentInfo = {
  name: string;
  displayName: string;
  description?: string;
};

export type OpenCodeCatalog = {
  checkedAt: number | null;
  installed: boolean;
  available: boolean;
  connectedProviderIds: string[];
  models: ModelInfo[];
  agents: OpenCodeAgentInfo[];
  error?: string;
};

export type CursorCatalog = {
  checkedAt: number | null;
  installed: boolean;
  available: boolean;
  models: ModelInfo[];
  status?: string;
  error?: string;
};

export type ProviderCatalog = {
  opencode: OpenCodeCatalog;
  cursor?: CursorCatalog;
};

export type ProviderCatalogResponse =
  | { ok: true; catalog: ProviderCatalog }
  | { ok: false; catalog: ProviderCatalog; error: string };

export type ProviderModelPreferences = {
  favoriteModels: string[];
  hiddenModels: string[];
  customModels: string[];
};

export type ModelPreferencesByProvider = Partial<Record<ProviderId, ProviderModelPreferences>>;

export type ProviderRuntimeConfig = {
  /**
   * CLI executable or absolute path used for this provider. Examples:
   * "codex", "claude", "opencode", "agent", or "C:\\tools\\agent.exe".
   */
  binaryPath?: string;
  /** Provider-specific home/config directory. Used by Claude and Codex. */
  homePath?: string;
  /** Account-specific Codex home that overrides CODEX_HOME for this provider. */
  shadowHomePath?: string;
  /** Additional Claude CLI launch arguments for Agent SDK hosts that support them. */
  launchArgs?: string;
  /** Existing OpenCode server URL. Blank means debase starts a local server. */
  serverUrl?: string;
  /** Password for an existing OpenCode server. */
  serverPassword?: string;
  /** Cursor API endpoint override. */
  apiEndpoint?: string;
};

export type ProviderRuntimeSettings = Partial<Record<ProviderId, ProviderRuntimeConfig>>;

export type ProviderCatalogRequest = {
  runtime?: ProviderRuntimeSettings;
  cwd?: string;
};

export const DEFAULT_PROVIDER_RUNTIME_SETTINGS: ProviderRuntimeSettings = {
  claude: { binaryPath: "claude", homePath: "", launchArgs: "" },
  codex: { binaryPath: "codex", homePath: "", shadowHomePath: "" },
  opencode: { binaryPath: "opencode", serverUrl: "", serverPassword: "" },
  cursor: { binaryPath: "agent", apiEndpoint: "" },
};

export const EMPTY_PROVIDER_CATALOG: ProviderCatalog = {
  opencode: {
    checkedAt: null,
    installed: false,
    available: false,
    connectedProviderIds: [],
    models: [],
    agents: [],
  },
  cursor: {
    checkedAt: null,
    installed: false,
    available: false,
    models: [],
  },
};

export const UNIVERSAL_EFFORTS: EffortLevel[] = ["low", "medium", "high"];

export const EMPTY_MODEL_PREFERENCES: ProviderModelPreferences = {
  favoriteModels: [],
  hiddenModels: [],
  customModels: [],
};

export const MODELS: ModelInfo[] = [
  {
    value: "claude-opus-4-7",
    provider: "claude",
    displayName: "Opus 4.7",
    description: "Most capable. Adaptive thinking, xhigh + max effort levels.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-opus-4-7[1m]",
    provider: "claude",
    displayName: "Opus 4.7 · 1M",
    description: "Opus 4.7 with the 1M-token context variant.",
    context: 1_000_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-opus-4-6",
    provider: "claude",
    displayName: "Opus 4.6",
    description: "Previous Opus generation. Adaptive thinking + max effort.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-sonnet-4-6",
    provider: "claude",
    displayName: "Sonnet 4.6",
    description: "Balanced. 1M context via beta toggle. Max effort.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-haiku-4-5-20251001",
    provider: "claude",
    displayName: "Haiku 4.5",
    description: "Fastest. Best for quick edits and low-latency turns.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.5",
    provider: "codex",
    displayName: "GPT-5.5",
    description: "Frontier model for complex coding, research, and real-world work.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh"],
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.4",
    provider: "codex",
    displayName: "GPT-5.4",
    description: "Strong model for everyday coding.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh"],
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.4-mini",
    provider: "codex",
    displayName: "GPT-5.4-Mini",
    description: "Small, fast, and cost-efficient model for simpler coding tasks.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh"],
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.3-codex",
    provider: "codex",
    displayName: "GPT-5.3-Codex",
    description: "Coding-optimized model.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh"],
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.3-codex-spark",
    provider: "codex",
    displayName: "GPT-5.3-Codex-Spark",
    description: "Ultra-fast coding model.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh"],
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.2",
    provider: "codex",
    displayName: "GPT-5.2",
    description: "Optimized for professional work and long-running agents.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh"],
    supportsAdaptiveThinking: false,
  },
];

export const CURSOR_MODELS: ModelInfo[] = [
  {
    value: "auto",
    provider: "cursor",
    displayName: "Auto",
    description: "Cursor chooses the model from the user's CLI account.",
    context: 200_000,
    supportsEffort: false,
    supportedEffortLevels: UNIVERSAL_EFFORTS,
    supportsAdaptiveThinking: false,
  },
  {
    value: "gpt-5.2",
    provider: "cursor",
    displayName: "GPT-5.2",
    description: "Cursor CLI model slug from the user's Cursor account.",
    context: 200_000,
    supportsEffort: false,
    supportedEffortLevels: UNIVERSAL_EFFORTS,
    supportsAdaptiveThinking: false,
  },
  {
    value: "sonnet-4.5-thinking",
    provider: "cursor",
    displayName: "Sonnet 4.5 Thinking",
    description: "Cursor CLI model slug from the user's Cursor account.",
    context: 200_000,
    supportsEffort: false,
    supportedEffortLevels: UNIVERSAL_EFFORTS,
    supportsAdaptiveThinking: false,
  },
];

export function findModel(
  id: string,
  catalog?: ProviderCatalog,
  preferences?: ModelPreferencesByProvider,
): ModelInfo | undefined {
  return allModels(catalog, preferences).find((m) => m.value === id);
}

export function modelsForProvider(
  provider: ProviderId,
  catalog?: ProviderCatalog,
  preferences?: ModelPreferencesByProvider,
): ModelInfo[] {
  const prefs = modelPreferencesForProvider(preferences, provider);
  const hidden = new Set(prefs.hiddenModels);
  const builtIn =
    provider === "opencode"
      ? (catalog?.opencode.models ?? [])
      : provider === "cursor"
        ? (catalog?.cursor?.available ? catalog.cursor.models : [])
      : MODELS.filter((m) => m.provider === provider);
  const visibleBuiltIns = builtIn.filter((m) => !hidden.has(m.value));
  if (provider === "opencode" || provider === "cursor") {
    return sortModelsForPreferences(visibleBuiltIns, prefs);
  }
  const builtInValues = new Set(builtIn.map((m) => m.value));
  const custom = prefs.customModels
    .map(normalizeCustomModelSlug)
    .filter((slug): slug is string => slug !== null && !builtInValues.has(slug))
    .map((slug) => customModelInfo(provider, slug));
  return sortModelsForPreferences([...visibleBuiltIns, ...custom], prefs);
}

export function defaultModelForProvider(
  provider: ProviderId,
  catalog?: ProviderCatalog,
  preferences?: ModelPreferencesByProvider,
): ModelInfo {
  const visible = modelsForProvider(provider, catalog, preferences);
  if (visible[0]) return visible[0];
  const unfiltered =
    provider === "opencode"
      ? (catalog?.opencode.models ?? [])
      : provider === "cursor"
        ? (catalog?.cursor?.models.length ? catalog.cursor.models : CURSOR_MODELS)
      : MODELS.filter((model) => model.provider === provider);
  return unfiltered[0] ?? MODELS[0]!;
}

export function allModels(
  catalog?: ProviderCatalog,
  preferences?: ModelPreferencesByProvider,
): ModelInfo[] {
  return PROVIDERS.flatMap((provider) => modelsForProvider(provider, catalog, preferences));
}

export function providerAvailable(provider: ProviderId, catalog?: ProviderCatalog): boolean {
  if (!isReadyProvider(provider)) return false;
  if (provider === "opencode") return catalog?.opencode.available === true;
  if (provider === "cursor") return catalog?.cursor?.available === true;
  return true;
}

/**
 * The 1M-token beta header (`context-1m-2025-08-07`) only applies to Sonnet
 * 4.x — for Opus the 1M variant is its own model id (`claude-opus-4-7[1m]`).
 */
export function modelSupports1MBeta(modelId: string): boolean {
  return modelId.startsWith("claude-sonnet-4");
}

export function modelPreferencesForProvider(
  preferences: ModelPreferencesByProvider | undefined,
  provider: ProviderId,
): ProviderModelPreferences {
  const raw = preferences?.[provider];
  return {
    favoriteModels: normalizeModelList(raw?.favoriteModels),
    hiddenModels: normalizeModelList(raw?.hiddenModels),
    customModels: normalizeModelList(raw?.customModels),
  };
}

export function normalizeCustomModelSlug(value: string): string | null {
  const slug = value.trim();
  if (!slug || slug.length > 160 || /\s/.test(slug)) return null;
  return slug;
}

export function isCustomModelAllowed(provider: ProviderId, model: string): boolean {
  return provider !== "opencode" && provider !== "cursor" && normalizeCustomModelSlug(model) !== null;
}

function normalizeModelList(values: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== "string") continue;
    const normalized = normalizeCustomModelSlug(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function customModelInfo(provider: ProviderId, slug: string): ModelInfo {
  return {
    value: slug,
    provider,
    displayName: slug,
    description: "User-added custom model slug.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: UNIVERSAL_EFFORTS,
    supportsAdaptiveThinking: provider === "claude",
  };
}

function sortModelsForPreferences(
  models: ModelInfo[],
  preferences: ProviderModelPreferences,
): ModelInfo[] {
  const favorite = new Set(preferences.favoriteModels);
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const af = favorite.has(a.model.value);
      const bf = favorite.has(b.model.value);
      if (af !== bf) return af ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.model);
}

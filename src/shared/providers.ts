import type { EffortLevel } from "./chat";

export const PROVIDERS = ["claude", "codex", "opencode"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  shortLabel: string;
  status: "ready" | "planned";
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
    status: "planned",
    description: "OpenAI codex CLI wrapper. Planned.",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "opencode",
    status: "planned",
    description: "OpenCode CLI wrapper. Planned.",
  },
};

export function isReadyProvider(id: ProviderId): boolean {
  return PROVIDER_META[id].status === "ready";
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
  displayName: string;
  description: string;
  context: 200_000 | 1_000_000;
  supportsEffort: boolean;
  supportedEffortLevels: EffortLevel[];
  supportsAdaptiveThinking: boolean;
};

export const UNIVERSAL_EFFORTS: EffortLevel[] = ["low", "medium", "high"];

export const MODELS: ModelInfo[] = [
  {
    value: "claude-opus-4-7",
    displayName: "Opus 4.7",
    description: "Most capable. Adaptive thinking, xhigh + max effort levels.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-opus-4-7[1m]",
    displayName: "Opus 4.7 · 1M",
    description: "Opus 4.7 with the 1M-token context variant.",
    context: 1_000_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-opus-4-6",
    displayName: "Opus 4.6",
    description: "Previous Opus generation. Adaptive thinking + max effort.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-sonnet-4-6",
    displayName: "Sonnet 4.6",
    description: "Balanced. 1M context via beta toggle. Max effort.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    value: "claude-haiku-4-5-20251001",
    displayName: "Haiku 4.5",
    description: "Fastest. Best for quick edits and low-latency turns.",
    context: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportsAdaptiveThinking: false,
  },
];

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.value === id);
}

/**
 * The 1M-token beta header (`context-1m-2025-08-07`) only applies to Sonnet
 * 4.x — for Opus the 1M variant is its own model id (`claude-opus-4-7[1m]`).
 */
export function modelSupports1MBeta(modelId: string): boolean {
  return modelId.startsWith("claude-sonnet-4");
}

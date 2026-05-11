import type { EffortLevel, RunConfig, RunMode, ThinkingMode } from "@shared/chat";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  THINKING_BUDGET_DEFAULT,
  THINKING_BUDGET_MAX,
  THINKING_BUDGET_MIN,
} from "@shared/chat";
import {
  defaultModelForProvider,
  findModel,
  modelsForProvider,
  modelSupports1MBeta,
  providerAvailable,
  type ProviderCatalog,
  type ModelPreferencesByProvider,
  PROVIDER_META,
  PROVIDERS,
  type ModelInfo,
  type OpenCodeAgentInfo,
  type ProviderId,
} from "@shared/providers";
import { Popover, MenuItem, MenuLabel, MenuDivider } from "./Popover";
import {
  AgentIcon,
  BarsIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  ClaudeMark,
  CodexMark,
  EyeIcon,
  LockIcon,
  LockOpenIcon,
  OpenCodeMark,
  PencilIcon,
  SparkleIcon,
} from "./icons";

type Props = {
  runConfig: RunConfig;
  disabled?: boolean;
  onChange: (next: Partial<RunConfig>) => void;
  enabledProviders?: Record<ProviderId, boolean>;
  providerCatalog?: ProviderCatalog;
  modelPreferences?: ModelPreferencesByProvider;
  /** When true, the Composer's ultrathink hue effect is forwarded to the model pill. */
  ultrathink?: boolean;
  globalModelPicker?: boolean;
};

type AccessLevel = "plan" | "supervised" | "auto-edit" | "full-access";

const ACCESS_LEVELS: {
  id: AccessLevel;
  label: string;
  sub: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "plan",
    label: "Plan",
    sub: "Read-only work; no file changes.",
    icon: <EyeIcon size={13} />,
  },
  {
    id: "supervised",
    label: "Sandboxed",
    sub: "Use normal project-scoped permissions.",
    icon: <LockIcon size={13} />,
  },
  {
    id: "auto-edit",
    label: "Auto-accept edits",
    sub: "Prefer edits while staying inside the project sandbox.",
    icon: <PencilIcon size={13} />,
  },
  {
    id: "full-access",
    label: "Full access",
    sub: "Allow commands and edits without prompts.",
    icon: <LockOpenIcon size={13} />,
  },
];

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

const THINKING_MODES: { id: ThinkingMode; label: string; sub: string }[] = [
  { id: "adaptive", label: "Adaptive", sub: "Claude decides when and how much." },
  { id: "enabled", label: "Fixed budget", sub: "Reserve a fixed thinking budget." },
  { id: "disabled", label: "Off", sub: "No extended thinking." },
];

export function RunControls({
  runConfig,
  disabled,
  onChange,
  enabledProviders,
  providerCatalog,
  modelPreferences,
  ultrathink,
  globalModelPicker,
}: Props) {
  const [modelSearch, setModelSearch] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const model = findModel(runConfig.model, providerCatalog, modelPreferences);
  const provider = model?.provider ?? runConfig.provider;
  const availableProviders = PROVIDERS.filter(
    (p) => providerAvailable(p, providerCatalog) && (enabledProviders?.[p] ?? true),
  );
  const pickerModels = useMemo(
    () => availableProviders.flatMap((p) => modelsForProvider(p, providerCatalog, modelPreferences)),
    [availableProviders, providerCatalog, modelPreferences],
  );
  const filteredPickerModels = useMemo(
    () => filterModels(pickerModels, modelSearch),
    [pickerModels, modelSearch],
  );
  // Always include the persisted value in the picker — even if the model
  // registry doesn't list it for the active model. Otherwise a thread saved
  // with `effort: "max"` on a model where the registry omits it would silently
  // disappear from the dropdown and the user could never re-select it.
  const baseEfforts = (model?.supportedEffortLevels ?? ["low", "medium", "high"]) as EffortLevel[];
  const allowedEfforts = baseEfforts.includes(runConfig.effort)
    ? baseEfforts
    : [...baseEfforts, runConfig.effort];
  const supports1M = model ? modelSupports1MBeta(model.value) : false;
  const supportsAdaptive = model?.supportsAdaptiveThinking ?? false;
  const access = deriveAccess(runConfig);
  const accessMeta = ACCESS_LEVELS.find((l) => l.id === access)!;
  const opencodeAgents = provider === "opencode" ? (providerCatalog?.opencode.agents ?? []) : [];
  const selectedOpenCodeAgent =
    opencodeAgents.find((agent) => agent.name === runConfig.opencodeAgent) ?? null;

  useEffect(() => {
    if (!globalModelPicker) return;
    const onToggle = () => {
      if (disabled) return;
      setModelSearch("");
      setModelOpen((open) => !open);
    };
    window.addEventListener("debase:toggle-model-picker", onToggle);
    return () => window.removeEventListener("debase:toggle-model-picker", onToggle);
  }, [disabled, globalModelPicker]);

  useEffect(() => {
    if (!modelOpen) return;
    const frame = window.requestAnimationFrame(() => modelSearchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [modelOpen]);

  useEffect(() => {
    if (provider !== "opencode") return;
    if (!runConfig.opencodeAgent || opencodeAgents.length === 0) return;
    if (opencodeAgents.some((agent) => agent.name === runConfig.opencodeAgent)) return;
    onChange({ opencodeAgent: undefined });
  }, [onChange, opencodeAgents, provider, runConfig.opencodeAgent]);

  useEffect(() => {
    if (!modelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey || event.shiftKey) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const selected = filteredPickerModels[Number(event.key) - 1];
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      chooseModel(selected, runConfig, onChange);
      setModelSearch("");
      setModelOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filteredPickerModels, modelOpen, onChange, runConfig]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover
        align="start"
        width={240}
        trigger={({ toggle, open }) => (
          <PillButton
            onClick={toggle}
            active={open}
            disabled={disabled}
            ariaLabel={`Choose provider (${PROVIDER_META[provider].label})`}
            title={PROVIDER_META[provider].label}
            compact
          >
            <span className={provider === "claude" && ultrathink ? "ultrathink-hue" : ""}>
              <ProviderGlyph provider={provider} size={12} />
            </span>
            <Chevron />
          </PillButton>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Provider</MenuLabel>
            {availableProviders.map((p) => {
              const nextModel = defaultModelForProvider(p, providerCatalog, modelPreferences);
              return (
                <MenuItem
                  key={p}
                  active={p === provider}
                  icon={<ProviderGlyph provider={p} size={13} />}
                  hint={PROVIDER_META[p].description}
                  onClick={() => {
                    const nextEffort = adjustEffortForModel(
                      runConfig.effort,
                      nextModel,
                    );
                    const nextThinking =
                      runConfig.thinking === "adaptive" && !nextModel.supportsAdaptiveThinking
                        ? ("enabled" as ThinkingMode)
                        : runConfig.thinking;
                    onChange({
                      provider: p,
                      model: nextModel.value,
                      effort: nextEffort,
                      thinking: nextThinking,
                      context1M: false,
                      opencodeAgent: p === "opencode" ? runConfig.opencodeAgent : undefined,
                    });
                    close();
                  }}
                >
                  {PROVIDER_META[p].label}
                </MenuItem>
              );
            })}
          </>
        )}
      </Popover>
      {/* Model picker — branded with the Claude mark; hue-rotates while ultrathink is active. */}
      <Popover
        align="start"
        width={340}
        open={modelOpen}
        onOpenChange={(next) => {
          setModelOpen(next);
          if (next) setModelSearch("");
        }}
        trigger={({ toggle, open }) => (
          <PillButton
            onClick={toggle}
            active={open}
            disabled={disabled}
            ariaLabel="Choose model"
          >
            <span className={ultrathink ? "ultrathink-hue" : ""}>
              <ProviderGlyph provider={provider} size={12} />
            </span>
            <span className="text-ink">{model?.displayName ?? runConfig.model}</span>
            <Chevron />
          </PillButton>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Models</MenuLabel>
            <div className="sticky top-0 z-10 border-b border-rule bg-canvas px-2 pb-2">
              <input
                ref={modelSearchRef}
                type="search"
                value={modelSearch}
                autoFocus
                placeholder="Search models"
                spellCheck={false}
                onChange={(event) => setModelSearch(event.target.value)}
                className="h-7 w-full rounded-sm border border-rule bg-surface px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
              />
            </div>
            {filteredPickerModels.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-ink-3">
                No models match.
              </div>
            ) : null}
            {filteredPickerModels.map((m) => (
              <MenuItem
                key={m.value}
                active={m.value === runConfig.model}
                icon={<ProviderGlyph provider={m.provider} size={13} />}
                hint={
                  <span>
                    {fmtContext(m.context)} · {m.description}
                  </span>
                }
                onClick={() => {
                  const nextEffort = adjustEffortForModel(runConfig.effort, m);
                  const nextThinking =
                    runConfig.thinking === "adaptive" && !m.supportsAdaptiveThinking
                      ? ("enabled" as ThinkingMode)
                      : runConfig.thinking;
                  const next: Partial<RunConfig> = {
                    provider: m.provider,
                    model: m.value,
                    effort: nextEffort,
                    thinking: nextThinking,
                    opencodeAgent: m.provider === "opencode" ? runConfig.opencodeAgent : undefined,
                  };
                  // If the new model doesn't support 1M context, the toggle
                  // disappears from the UI — without this the persisted
                  // `context1M: true` becomes orphan state that silently
                  // continues to be sent to the SDK.
                  if (runConfig.context1M && !modelSupports1MBeta(m.value)) {
                    next.context1M = false;
                  }
                  onChange(next);
                  setModelSearch("");
                  close();
                }}
              >
                {m.displayName}
              </MenuItem>
            ))}
          </>
        )}
      </Popover>

      {provider === "opencode" && opencodeAgents.length > 0 && (
        <OpenCodeAgentPicker
          agents={opencodeAgents}
          selectedAgent={selectedOpenCodeAgent}
          value={runConfig.opencodeAgent}
          mode={runConfig.mode}
          disabled={disabled}
          onChange={(opencodeAgent) => onChange({ opencodeAgent })}
        />
      )}

      {/* Access picker — sandboxed / auto-edit / full access. */}
      <Popover
        align="start"
        width={300}
        trigger={({ toggle, open }) => (
          <PillButton
            onClick={toggle}
            active={open}
            disabled={disabled}
            ariaLabel="Choose access level"
            tone={access === "full-access" ? "accent" : undefined}
          >
            <span
              className={
                access === "full-access" ? "text-accent-deep" : "text-ink-3"
              }
            >
              {accessMeta.icon}
            </span>
            <span className={access === "full-access" ? "text-accent-deep" : "text-ink"}>
              {accessMeta.label}
            </span>
            <Chevron />
          </PillButton>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Access</MenuLabel>
            {ACCESS_LEVELS.map((level) => (
              <MenuItem
                key={level.id}
                active={level.id === access}
                icon={level.icon}
                hint={level.sub}
                onClick={() => {
                  onChange(applyAccess(level.id, runConfig));
                  close();
                }}
              >
                {level.label}
              </MenuItem>
            ))}
          </>
        )}
      </Popover>

      {/* Effort picker. */}
      <Popover
        align="start"
        width={200}
        trigger={({ toggle, open }) => (
          <PillButton onClick={toggle} active={open} disabled={disabled} ariaLabel="Choose effort">
            <span className="text-ink-3">
              <BarsIcon size={11} />
            </span>
            <span className="text-ink">{EFFORT_LABELS[runConfig.effort]}</span>
            <Chevron />
          </PillButton>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Effort</MenuLabel>
            {allowedEfforts.map((e) => (
              <MenuItem
                key={e}
                active={e === runConfig.effort}
                icon={<BarsIcon size={13} />}
                onClick={() => {
                  onChange({ effort: e });
                  close();
                }}
              >
                {EFFORT_LABELS[e]}
              </MenuItem>
            ))}
          </>
        )}
      </Popover>

      {/* Codex speed tier. Mirrors Codex CLI fast mode without changing reasoning effort. */}
      {provider === "codex" && (
        <Popover
          align="start"
          width={220}
          trigger={({ toggle, open }) => (
            <PillButton
              onClick={toggle}
              active={open}
              disabled={disabled}
              ariaLabel="Choose Codex speed"
              tone={runConfig.serviceTier === "fast" ? "accent" : undefined}
            >
              <span
                className={
                  runConfig.serviceTier === "fast" ? "text-accent-deep" : "text-ink-3"
                }
              >
                <BoltIcon size={11} />
              </span>
              <span
                className={
                  runConfig.serviceTier === "fast" ? "text-accent-deep" : "text-ink"
                }
              >
                {runConfig.serviceTier === "fast" ? "fast" : "normal"}
              </span>
              <Chevron />
            </PillButton>
          )}
        >
          {({ close }) => (
            <>
              <MenuLabel>Codex speed</MenuLabel>
              <MenuItem
                active={runConfig.serviceTier !== "fast"}
                icon={<BoltIcon size={13} />}
                hint="Use the standard service tier."
                onClick={() => {
                  onChange({ serviceTier: "standard" });
                  close();
                }}
              >
                Normal
              </MenuItem>
              <MenuItem
                active={runConfig.serviceTier === "fast"}
                icon={<BoltIcon size={13} />}
                hint="Use Codex fast mode for lower latency."
                onClick={() => {
                  onChange({ serviceTier: "fast" });
                  close();
                }}
              >
                Fast
              </MenuItem>
            </>
          )}
        </Popover>
      )}

      {/* Thinking mode picker. */}
      {provider === "claude" && (
      <Popover
        align="start"
        width={260}
        trigger={({ toggle, open }) => (
          <PillButton onClick={toggle} active={open} disabled={disabled} ariaLabel="Thinking">
            <span className="text-ink-3">
              <SparkleIcon size={11} />
            </span>
            <span className="text-ink">{labelForThinking(runConfig.thinking)}</span>
            <Chevron />
          </PillButton>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Extended thinking</MenuLabel>
            {THINKING_MODES.map((m) => {
              const adaptiveDisabled = m.id === "adaptive" && !supportsAdaptive;
              return (
                <MenuItem
                  key={m.id}
                  active={m.id === runConfig.thinking}
                  disabled={adaptiveDisabled}
                  icon={<SparkleIcon size={13} />}
                  hint={
                    adaptiveDisabled
                      ? "Not available on this model — pick a different model."
                      : m.sub
                  }
                  onClick={() => {
                    if (adaptiveDisabled) return;
                    onChange({ thinking: m.id });
                    close();
                  }}
                >
                  {m.label}
                </MenuItem>
              );
            })}
            {runConfig.thinking === "enabled" && (
              <>
                <MenuDivider />
                <div className="px-3 py-2">
                  <label className="block text-[11px] text-ink-3">Budget tokens</label>
                  <input
                    type="number"
                    min={THINKING_BUDGET_MIN}
                    max={THINKING_BUDGET_MAX}
                    step={1024}
                    value={runConfig.thinkingBudget ?? THINKING_BUDGET_DEFAULT}
                    onChange={(e) => {
                      const raw = Number(e.target.value) || 0;
                      const clamped = Math.max(
                        THINKING_BUDGET_MIN,
                        Math.min(THINKING_BUDGET_MAX, raw),
                      );
                      onChange({ thinkingBudget: clamped });
                    }}
                    className="mt-1 w-full rounded-sm border border-rule bg-canvas px-2 py-1 font-mono text-[12px] text-ink focus:border-rule-strong focus:outline-none"
                  />
                  <div className="mt-1 font-mono text-[10.5px] text-ink-3">
                    min {THINKING_BUDGET_MIN.toLocaleString()} · max{" "}
                    {THINKING_BUDGET_MAX.toLocaleString()} (limited by model max_tokens)
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </Popover>
      )}

      {/* 1M context toggle (Sonnet 4.x only). */}
      {supports1M && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ context1M: !runConfig.context1M })}
          aria-pressed={runConfig.context1M}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            runConfig.context1M
              ? "border-accent/60 bg-accent-soft/40 text-accent-deep"
              : "border-rule bg-canvas text-ink-2 hover:border-rule-strong hover:text-ink"
          }`}
        >
          {runConfig.context1M ? <CheckIcon size={11} /> : null}
          <span className="font-mono text-[11.5px]">1M ctx</span>
        </button>
      )}
    </div>
  );
}

function OpenCodeAgentPicker({
  agents,
  selectedAgent,
  value,
  mode,
  disabled,
  onChange,
}: {
  agents: OpenCodeAgentInfo[];
  selectedAgent: OpenCodeAgentInfo | null;
  value?: string;
  mode: RunMode;
  disabled?: boolean;
  onChange: (agent: string | undefined) => void;
}) {
  const fallbackLabel = mode === "plan" ? "Plan" : "Auto";
  const buttonLabel = selectedAgent?.displayName ?? fallbackLabel;

  return (
    <Popover
      align="start"
      width={260}
      trigger={({ toggle, open }) => (
        <PillButton
          onClick={toggle}
          active={open}
          disabled={disabled}
          ariaLabel="Choose OpenCode agent"
        >
          <span className="text-ink-3">
            <AgentIcon size={11} />
          </span>
          <span className="text-ink">{buttonLabel}</span>
          <Chevron />
        </PillButton>
      )}
    >
      {({ close }) => (
        <>
          <MenuLabel>OpenCode agent</MenuLabel>
          <MenuItem
            active={!value}
            icon={<AgentIcon size={13} />}
            hint="Use OpenCode's default agent for the current mode."
            onClick={() => {
              onChange(undefined);
              close();
            }}
          >
            {fallbackLabel}
          </MenuItem>
          <MenuDivider />
          {agents.map((agent) => (
            <MenuItem
              key={agent.name}
              active={agent.name === value}
              icon={<AgentIcon size={13} />}
              hint={agent.description}
              onClick={() => {
                onChange(agent.name);
                close();
              }}
            >
              {agent.displayName}
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  );
}

function PillButton({
  children,
  onClick,
  active,
  disabled,
  ariaLabel,
  title,
  tone,
  compact,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  tone?: "accent";
  compact?: boolean;
}) {
  const accent = tone === "accent";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? "w-10 justify-center px-0" : "px-2"
      } ${
        active
          ? accent
            ? "border-accent/60 bg-accent-soft/60"
            : "border-rule-strong bg-surface"
          : accent
            ? "border-accent/40 bg-accent-soft/30 hover:border-accent/60 hover:bg-accent-soft/50"
            : "border-rule bg-canvas hover:border-rule-strong hover:bg-surface/40"
      }`}
    >
      {children}
    </button>
  );
}

function Chevron() {
  return (
    <span className="text-ink-3">
      <ChevronDownIcon size={11} />
    </span>
  );
}

function ProviderGlyph({ provider, size }: { provider: ProviderId; size: number }) {
  if (provider === "codex") return <CodexMark size={size} />;
  if (provider === "opencode") return <OpenCodeMark size={size} />;
  if (provider === "cursor") return <AgentIcon size={size} />;
  return <ClaudeMark size={size} />;
}

function deriveAccess(rc: RunConfig): AccessLevel {
  if (rc.fullAccess) return "full-access";
  if (rc.mode === "plan") return "plan";
  if (rc.mode === "auto-edit") return "auto-edit";
  return "supervised";
}

function applyAccess(level: AccessLevel, rc: RunConfig): Partial<RunConfig> {
  switch (level) {
    case "plan":
      return { mode: "plan" as RunMode, fullAccess: false };
    case "supervised":
      return { mode: "build" as RunMode, fullAccess: false };
    case "auto-edit":
      return { mode: "auto-edit" as RunMode, fullAccess: false };
    case "full-access":
      // Preserve the underlying mode so toggling back returns to whatever the
      // user picked before; only the `fullAccess` override changes.
      return { mode: rc.mode, fullAccess: true };
  }
}

function labelForThinking(t: ThinkingMode): string {
  return THINKING_MODES.find((x) => x.id === t)?.label ?? t;
}

function fmtContext(c: number): string {
  if (c >= 1_000_000) return `${(c / 1_000_000).toFixed(0)}M context`;
  if (c >= 1_000) return `${(c / 1_000).toFixed(0)}K context`;
  return `${c}`;
}

function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return models;

  return models.filter((model) => {
    const provider = PROVIDER_META[model.provider];
    const haystack = [
      model.displayName,
      model.value,
      model.description,
      provider.label,
      provider.shortLabel,
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function adjustEffortForModel(current: EffortLevel, model: { supportedEffortLevels: EffortLevel[] }): EffortLevel {
  if (model.supportedEffortLevels.includes(current)) return current;
  return "high";
}

function chooseModel(
  model: ModelInfo,
  runConfig: RunConfig,
  onChange: (next: Partial<RunConfig>) => void,
): void {
  const nextEffort = adjustEffortForModel(runConfig.effort, model);
  const nextThinking =
    runConfig.thinking === "adaptive" && !model.supportsAdaptiveThinking
      ? ("enabled" as ThinkingMode)
      : runConfig.thinking;
  const next: Partial<RunConfig> = {
    provider: model.provider,
    model: model.value,
    effort: nextEffort,
    thinking: nextThinking,
    opencodeAgent: model.provider === "opencode" ? runConfig.opencodeAgent : undefined,
  };
  if (runConfig.context1M && !modelSupports1MBeta(model.value)) {
    next.context1M = false;
  }
  onChange(next);
}

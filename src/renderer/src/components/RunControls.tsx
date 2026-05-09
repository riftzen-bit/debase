import type { EffortLevel, RunConfig, RunMode, ThinkingMode } from "@shared/chat";
import {
  THINKING_BUDGET_DEFAULT,
  THINKING_BUDGET_MAX,
  THINKING_BUDGET_MIN,
} from "@shared/chat";
import { findModel, MODELS, modelSupports1MBeta } from "@shared/providers";
import { Popover, MenuItem, MenuLabel, MenuDivider } from "./Popover";
import {
  BarsIcon,
  CheckIcon,
  ChevronDownIcon,
  ClaudeMark,
  EyeIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  SparkleIcon,
} from "./icons";

type Props = {
  runConfig: RunConfig;
  disabled?: boolean;
  onChange: (next: Partial<RunConfig>) => void;
  /** When true, the Composer's ultrathink hue effect is forwarded to the model pill. */
  ultrathink?: boolean;
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
    sub: "Draft a plan only — no commands or file changes.",
    icon: <EyeIcon size={13} />,
  },
  {
    id: "supervised",
    label: "Supervised",
    sub: "Ask before commands and file changes.",
    icon: <LockIcon size={13} />,
  },
  {
    id: "auto-edit",
    label: "Auto-accept edits",
    sub: "Auto-approve edits, ask before other actions.",
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

export function RunControls({ runConfig, disabled, onChange, ultrathink }: Props) {
  const model = findModel(runConfig.model);
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

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Model picker — branded with the Claude mark; hue-rotates while ultrathink is active. */}
      <Popover
        align="start"
        width={300}
        trigger={({ toggle, open }) => (
          <PillButton onClick={toggle} active={open} disabled={disabled} ariaLabel="Choose model">
            <span className={ultrathink ? "ultrathink-hue" : ""}>
              <ClaudeMark size={12} />
            </span>
            <span className="text-ink">{model?.displayName ?? runConfig.model}</span>
            <Chevron />
          </PillButton>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Models</MenuLabel>
            {MODELS.map((m) => (
              <MenuItem
                key={m.value}
                active={m.value === runConfig.model}
                icon={<ClaudeMark size={13} />}
                hint={
                  <span>
                    {fmtContext(m.context)} · {m.description}
                  </span>
                }
                onClick={() => {
                  const nextEffort = adjustEffortForModel(runConfig.effort, m.value);
                  const nextThinking =
                    runConfig.thinking === "adaptive" && !m.supportsAdaptiveThinking
                      ? ("enabled" as ThinkingMode)
                      : runConfig.thinking;
                  const next: Partial<RunConfig> = {
                    model: m.value,
                    effort: nextEffort,
                    thinking: nextThinking,
                  };
                  // If the new model doesn't support 1M context, the toggle
                  // disappears from the UI — without this the persisted
                  // `context1M: true` becomes orphan state that silently
                  // continues to be sent to the SDK.
                  if (runConfig.context1M && !modelSupports1MBeta(m.value)) {
                    next.context1M = false;
                  }
                  onChange(next);
                  close();
                }}
              >
                {m.displayName}
              </MenuItem>
            ))}
          </>
        )}
      </Popover>

      {/* Access picker — Supervised / Auto-accept edits / Full access. */}
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

      {/* Thinking mode picker. */}
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

function PillButton({
  children,
  onClick,
  active,
  disabled,
  ariaLabel,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  tone?: "accent";
}) {
  const accent = tone === "accent";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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

function adjustEffortForModel(current: EffortLevel, modelId: string): EffortLevel {
  const m = findModel(modelId);
  if (!m) return current;
  if (m.supportedEffortLevels.includes(current)) return current;
  return "high";
}

import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { PROVIDER_META, PROVIDERS, type ProviderId } from "@shared/providers";
import {
  AgentIcon,
  BrandMark,
  ChevronLeftIcon,
  ClaudeMark,
  CodexMark,
  GearIcon,
  OpenCodeMark,
  SparkleIcon,
} from "./icons";
import { RunControls } from "./RunControls";
import {
  NON_CONFIGURABLE_IDS,
  SHORTCUTS,
  formatKeys,
  type ShortcutScope,
} from "../lib/shortcuts";
import { useKeybindings } from "../state/keybindings";
import type { EnvironmentInfo } from "@shared/chat";

export type SettingsCategory =
  | "general"
  | "providers"
  | "shortcuts"
  | "environment"
  | "about";

type Props = {
  onClose: () => void;
  category?: SettingsCategory;
  onCategoryChange?: (next: SettingsCategory) => void;
};

const CATEGORIES: {
  id: SettingsCategory;
  label: string;
  hint: string;
  icon: ReactNode;
}[] = [
  { id: "general", label: "General", hint: "Defaults for new threads", icon: <SparkleIcon size={13} /> },
  { id: "providers", label: "Providers", hint: "Claude · Codex · OpenCode", icon: <AgentIcon size={13} /> },
  { id: "shortcuts", label: "Shortcuts", hint: "Keyboard reference", icon: <GearIcon size={13} /> },
  { id: "environment", label: "Environment", hint: "App + system info", icon: <GearIcon size={13} /> },
  { id: "about", label: "About", hint: "What this is", icon: <BrandMark size={13} /> },
];

export function Settings({ onClose, category, onCategoryChange }: Props) {
  const [internalActive, setInternalActive] = useState<SettingsCategory>("general");
  const active = category ?? internalActive;
  const setActive = (next: SettingsCategory) => {
    if (onCategoryChange) onCategoryChange(next);
    else setInternalActive(next);
  };
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    window.api.env.get().then((info) => {
      if (mounted) setEnv(info);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section
      role="region"
      aria-label="Settings"
      className="flex h-full min-h-0 flex-col bg-canvas overflow-hidden"
    >
      <Header onClose={onClose} />

      <div className="grid min-h-0 flex-1 grid-cols-[208px_1fr] overflow-hidden">
        <aside className="border-r border-rule bg-surface/30 overflow-y-auto">
          <nav className="flex flex-col gap-0.5 p-3">
            {CATEGORIES.map((c) => {
              const isActive = c.id === active;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`group flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-canvas shadow-sm ring-1 ring-rule-strong/60"
                      : "hover:bg-canvas/60"
                  }`}
                >
                  <span
                    className={`mt-[3px] shrink-0 ${isActive ? "text-accent-deep" : "text-ink-3 group-hover:text-ink-2"}`}
                  >
                    {c.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] font-medium ${isActive ? "text-ink" : "text-ink-2"}`}
                    >
                      {c.label}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {c.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="px-4 pb-4 pt-2 font-mono text-[10.5px] text-ink-3">
            <kbd className="rounded-sm border border-rule px-1 py-0.5 text-ink-2">Esc</kbd>
            <span className="ml-1.5">close</span>
          </div>
        </aside>

        <div className="overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-10">
            {active === "general" && <GeneralPane />}
            {active === "providers" && <ProvidersPane />}
            {active === "shortcuts" && <ShortcutsPane />}
            {active === "environment" && <EnvironmentPane env={env} />}
            {active === "about" && <AboutPane />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rule bg-canvas px-6 py-3.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to chat"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-canvas px-2 text-[12px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
        >
          <ChevronLeftIcon size={11} />
          <span>Back</span>
        </button>
        <span className="h-4 w-px bg-rule" />
        <h1 className="text-[15px] font-medium tracking-tight text-ink">Settings</h1>
        <span className="font-mono text-[10.5px] text-ink-3">debase · paper edition</span>
      </div>
      <div className="flex items-center gap-3 text-[10.5px] text-ink-3">
        <span className="font-mono">⌘,</span>
        <span>toggle</span>
      </div>
    </header>
  );
}

function GeneralPane() {
  const { state, updateDefaultRunConfig, setEditorCommand, setAskBeforeTools } = useStore();
  return (
    <Pane
      eyebrow="Run defaults"
      title="What every new thread starts with"
      description="These values seed the model picker on each new thread. Existing threads keep whatever they were last set to."
    >
      <Card>
        <RunControls
          runConfig={state.settings.defaults}
          onChange={(next) => updateDefaultRunConfig(next)}
        />
        <FieldHint>
          Pick a sensible default — you can change any of these per-thread from the composer
          row at the bottom of a chat. Full access bypasses permission prompts; keep that off
          unless you actually want the agent acting unsupervised.
        </FieldHint>
      </Card>
      <ApprovalToggle
        enabled={state.settings.askBeforeTools === true}
        onChange={setAskBeforeTools}
      />
      <EditorCommandField
        value={state.settings.editorCommand ?? ""}
        onChange={setEditorCommand}
      />
    </Pane>
  );
}

function ApprovalToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] italic text-ink-3">approvals</div>
          <h3 className="mt-1 text-[14.5px] text-ink">Ask before each tool call</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            When on, every Bash / Edit / Write / etc. pauses for an inline allow-or-deny click.
            Useful for read-through review or untrusted prompts. Full-access mode bypasses this
            regardless. Adds latency on every tool — leave off for unattended runs.
          </p>
        </div>
        <Toggle checked={enabled} onChange={onChange} />
      </div>
    </Card>
  );
}

function EditorCommandField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Card>
      <div className="space-y-2">
        <label className="block">
          <span className="block font-mono text-[11px] italic text-ink-3">editor command</span>
          <span className="mt-1 block text-[13.5px] text-ink">Open in editor</span>
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='e.g. code, subl, "C:\\Program Files\\Microsoft VS Code\\Code.exe" --new-window'
          spellCheck={false}
          className="w-full rounded-md border border-rule bg-canvas px-3 py-1.5 font-mono text-[12.5px] text-ink placeholder:text-ink-3 focus:border-rule-strong focus:outline-none"
        />
        <p className="text-[12px] leading-relaxed text-ink-3">
          Argv-style command. The project path is appended as the final argument. Quote tokens
          that contain spaces. Leave empty to disable the action — debase falls back to the OS
          file handler.
        </p>
      </div>
    </Card>
  );
}

function ShortcutsPane() {
  const { overrides, configPath, loadError, setOverride, revealFile } = useKeybindings();
  const groups: { scope: ShortcutScope; title: string; description: string }[] = [
    { scope: "global", title: "Global", description: "Work anywhere in the app." },
    { scope: "chat", title: "Chat", description: "Active when a thread is selected." },
    {
      scope: "composer",
      title: "Composer",
      description: "Available while typing a prompt — these stay fixed.",
    },
  ];
  return (
    <Pane
      eyebrow="Shortcuts"
      title="Keyboard reference"
      description="Click a binding to remap it. Overrides live in keybindings.json so you can also edit the file directly. Composer keys (Enter, ↑) are fixed because they're textarea-specific."
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] italic text-ink-3">config file</div>
            <p className="mt-1 truncate font-mono text-[12px] text-ink">
              {configPath || "—"}
            </p>
            {loadError && (
              <p className="mt-1 text-[12px] text-error">{loadError}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void revealFile()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-canvas px-3 text-[12px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
          >
            Open in OS
          </button>
        </div>
      </Card>
      {groups.map((g) => (
        <Card key={g.scope} padded={false}>
          <div className="border-b border-rule px-5 py-3">
            <div className="font-mono text-[11px] italic text-ink-3">{g.title.toLowerCase()}</div>
            <h3 className="mt-1 text-[14.5px] text-ink">{g.title}</h3>
            <p className="mt-0.5 text-[12px] text-ink-3">{g.description}</p>
          </div>
          <ul className="divide-y divide-rule/60">
            {SHORTCUTS.filter((s) => s.scope === g.scope).map((s) => (
              <ShortcutRow
                key={s.id}
                id={s.id}
                description={s.description}
                defaultKeys={s.keys}
                overrideKeys={overrides[s.id]}
                editable={!NON_CONFIGURABLE_IDS.has(s.id)}
                onSave={(spec) => void setOverride(s.id, spec)}
              />
            ))}
          </ul>
        </Card>
      ))}
    </Pane>
  );
}

function ShortcutRow({
  id,
  description,
  defaultKeys,
  overrideKeys,
  editable,
  onSave,
}: {
  id: string;
  description: string;
  defaultKeys: string;
  overrideKeys: string | undefined;
  editable: boolean;
  onSave: (spec: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string>(overrideKeys ?? defaultKeys);

  useEffect(() => {
    setPending(overrideKeys ?? defaultKeys);
  }, [overrideKeys, defaultKeys, editing]);

  const effective = overrideKeys ?? defaultKeys;
  const customised = typeof overrideKeys === "string" && overrideKeys !== defaultKeys;

  const onCapture = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(false);
      return;
    }
    const parts: string[] = [];
    if (e.ctrlKey && e.metaKey) parts.push("mod");
    else {
      if (e.metaKey) parts.push("mod");
      else if (e.ctrlKey) parts.push("mod");
    }
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    const k = e.key;
    if (k.length === 1) {
      parts.push(k.toLowerCase());
    } else {
      const lower = k.toLowerCase();
      if (lower.startsWith("arrow")) parts.push(lower);
      else if (lower === "escape" || lower === "enter" || lower === "tab") parts.push(lower);
      else if (lower === " ") parts.push("space");
      else if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") {
        // Ignore lone modifiers — wait for the user to press a non-mod key.
        return;
      } else {
        parts.push(lower);
      }
    }
    setPending(parts.join("+"));
    setRecording(false);
  };

  return (
    <li
      className="flex items-center justify-between gap-4 px-5 py-2.5"
      tabIndex={editing ? 0 : -1}
      onKeyDown={onCapture}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink-2">{description}</span>
        {customised && (
          <span className="block font-mono text-[10.5px] italic text-ink-3">
            default: {formatKeys(defaultKeys)}
          </span>
        )}
      </span>
      {!editable ? (
        <kbd className="shrink-0 rounded-sm border border-rule bg-surface/50 px-2 py-0.5 font-mono text-[11px] text-ink">
          {formatKeys(effective)}
        </kbd>
      ) : editing ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRecording((v) => !v)}
            className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              recording
                ? "border-accent bg-accent-soft/70 text-accent-deep"
                : "border-rule-strong bg-canvas text-ink hover:bg-surface"
            }`}
          >
            {recording ? "press keys…" : pending ? formatKeys(pending) : "(empty)"}
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(pending);
              setEditing(false);
              setRecording(false);
            }}
            className="rounded-md border border-accent/50 bg-accent-soft/60 px-2 py-0.5 text-[11px] text-accent-deep hover:bg-accent-soft"
          >
            save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setRecording(false);
            }}
            className="rounded-md border border-rule bg-canvas px-2 py-0.5 text-[11px] text-ink-2 hover:bg-surface"
          >
            cancel
          </button>
          {customised && (
            <button
              type="button"
              onClick={() => {
                onSave(null);
                setEditing(false);
                setRecording(false);
              }}
              title="Reset to default"
              className="rounded-md border border-rule bg-canvas px-2 py-0.5 text-[11px] text-ink-3 hover:bg-surface hover:text-ink-2"
            >
              reset
            </button>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Remap ${id}`}
          className="shrink-0 rounded-sm border border-rule bg-surface/50 px-2 py-0.5 font-mono text-[11px] text-ink transition-colors hover:border-rule-strong hover:bg-surface"
        >
          {formatKeys(effective)}
        </button>
      )}
    </li>
  );
}

function ProvidersPane() {
  const { state, setProviderEnabled } = useStore();
  return (
    <Pane
      eyebrow="Providers"
      title="Which agents are available"
      description="Claude is the only ready provider. Codex and OpenCode are wired into the UI for when their CLI bridges land — their toggles will unlock here once they ship."
    >
      <ul className="divide-y divide-rule rounded-lg border border-rule bg-canvas">
        {PROVIDERS.map((id) => {
          const meta = PROVIDER_META[id];
          const planned = meta.status === "planned";
          return (
            <li
              key={id}
              className="flex items-start justify-between gap-5 px-5 py-4"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ProviderIcon id={id} planned={planned} />
                  <span className="text-[13.5px] font-medium text-ink">{meta.label}</span>
                  {planned && (
                    <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] italic text-ink-3">
                      planned
                    </span>
                  )}
                </div>
                <p className="max-w-md text-[12.5px] leading-relaxed text-ink-3">
                  {meta.description}
                </p>
              </div>
              <Toggle
                checked={state.settings.enabledProviders[id]}
                disabled={planned}
                onChange={(v) => setProviderEnabled(id as ProviderId, v)}
              />
            </li>
          );
        })}
      </ul>
    </Pane>
  );
}

function EnvironmentPane({ env }: { env: EnvironmentInfo | null }) {
  return (
    <Pane
      eyebrow="Environment"
      title="App and system info"
      description="Read-only. Useful for triaging setup issues — paste this into a bug report if Claude won't authenticate."
    >
      <Card padded={false}>
        <dl className="grid grid-cols-[140px_1fr] gap-x-6 gap-y-0 px-5 py-4 font-mono text-[12px]">
          <Row k="version" v={env?.appVersion ?? "—"} />
          <Row k="platform" v={env?.platform ?? "—"} />
          <Row k="home" v={env?.homeDir ?? "—"} />
          <Row k="default cwd" v={env?.defaultCwd ?? "—"} />
          <Row k="ANTHROPIC_API_KEY" v={env?.hasAnthropicEnvKey ? "set in env" : "not set"} />
        </dl>
      </Card>
      <Note>
        The Claude provider authenticates through your{" "}
        <span className="font-mono text-ink-2">claude</span> CLI login. You don't need to set
        an API key here — debase reuses whatever the CLI has stored.
      </Note>
    </Pane>
  );
}

function AboutPane() {
  return (
    <Pane
      eyebrow="About"
      title="debase"
      description="A desktop shell that wraps Claude Code (and, eventually, Codex and OpenCode) into one interface. Threads are organised by project, the project's path becomes the agent's working directory, and the underlying CLI behavior is left untouched."
    >
      <Card>
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
          <p>
            <span className="font-medium text-ink">Stance.</span> debase is a thin shell. It
            doesn't add a custom system prompt, it doesn't reinterpret tool calls, and it
            doesn't hide what the agent is doing. Tool runs stream into a trace; edits and
            writes show up as inline diffs.
          </p>
          <p>
            <span className="font-medium text-ink">Stack.</span> Electron 33 ·
            electron-vite · React 19 · Tailwind 4 · @anthropic-ai/claude-agent-sdk.
          </p>
          <p>
            <span className="font-medium text-ink">Aesthetic.</span> Warm paper, ochre accent,
            JetBrains Mono in the composer and code, Geist Sans everywhere else. No dark
            mode, no purple gradients, no all-caps tracking labels.
          </p>
        </div>
      </Card>
    </Pane>
  );
}

function ProviderIcon({ id, planned }: { id: ProviderId; planned: boolean }) {
  // Each provider gets its own glyph — using ClaudeMark for everything was
  // an AI-slop default that implied Codex/OpenCode were Anthropic products.
  // Claude has the official Anthropic mark (vendored from the SDK); the
  // other two get neutral editorial placeholders until/unless real logos
  // are vendored.
  const tone = planned ? "text-ink-3" : "text-accent";
  if (id === "claude") {
    return (
      <span className={tone}>
        <ClaudeMark size={14} />
      </span>
    );
  }
  if (id === "codex") {
    return (
      <span className={tone}>
        <CodexMark size={14} />
      </span>
    );
  }
  return (
    <span className={tone}>
      <OpenCodeMark size={14} />
    </span>
  );
}

function Pane({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11.5px] italic text-ink-3">
          {eyebrow}
        </div>
        <h2 className="text-[24px] font-light leading-tight tracking-tight text-ink text-balance">
          {title}
        </h2>
        {description && (
          <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">
            {description}
          </p>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Card({
  children,
  padded = true,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-rule bg-canvas ${
        padded ? "px-5 py-5" : ""
      }`}
    >
      {children}
    </div>
  );
}

function FieldHint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 max-w-prose text-[12px] leading-relaxed text-ink-3">
      {children}
    </p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] leading-relaxed text-ink-3">
      {children}
    </p>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-accent/60 bg-accent-soft"
          : "border-rule bg-surface"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-canvas shadow-sm transition-transform ${
          checked ? "translate-x-[18px] bg-accent" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="border-b border-rule/60 py-2 text-ink-3">{k}</dt>
      <dd className="border-b border-rule/60 py-2 truncate text-ink">{v}</dd>
    </>
  );
}

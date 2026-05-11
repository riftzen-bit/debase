import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import {
  modelPreferencesForProvider,
  modelsForProvider,
  normalizeCustomModelSlug,
  PROVIDER_META,
  PROVIDERS,
  type ModelInfo,
  type ProviderModelPreferences,
  type ProviderId,
  type ProviderRuntimeConfig,
} from "@shared/providers";
import {
  AgentIcon,
  ArchiveIcon,
  BrandMark,
  ChevronLeftIcon,
  CheckIcon,
  ClaudeMark,
  CloseIcon,
  CodexMark,
  GearIcon,
  GitBranchIcon,
  OpenCodeMark,
  PlusIcon,
  RestoreIcon,
  SparkleIcon,
  TrashIcon,
} from "./icons";
import { RunControls } from "./RunControls";
import {
  NON_CONFIGURABLE_IDS,
  SHORTCUTS,
  formatKeys,
  parseKey,
  type KeybindingCommand,
  type KeybindingRule,
  type ShortcutScope,
} from "../lib/shortcuts";
import { relativeTime, truncate } from "../lib/format";
import { useKeybindings } from "../state/keybindings";
import type { EnvironmentInfo, ProjectListSkillsResponse } from "@shared/chat";
import type {
  SourceControlCloneProtocol,
  SourceControlProviderDiscovery,
  SourceControlRepositoryVisibility,
  SourceControlScanResponse,
} from "@shared/sourceControl";
import { threadCwd } from "../lib/workdir";

export type SettingsCategory =
  | "general"
  | "providers"
  | "source-control"
  | "shortcuts"
  | "archived"
  | "diagnostics"
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
  { id: "providers", label: "Providers", hint: "Claude · Codex · OpenCode · Cursor", icon: <AgentIcon size={13} /> },
  { id: "source-control", label: "Source control", hint: "Git remotes + auth", icon: <GitBranchIcon size={13} /> },
  { id: "shortcuts", label: "Shortcuts", hint: "Keyboard reference", icon: <GearIcon size={13} /> },
  { id: "archived", label: "Archived", hint: "Tucked-away threads", icon: <ArchiveIcon size={13} /> },
  { id: "diagnostics", label: "Diagnostics", hint: "Health snapshot", icon: <CheckIcon size={13} /> },
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
            {active === "source-control" && <SourceControlPane />}
            {active === "shortcuts" && <ShortcutsPane />}
            {active === "archived" && <ArchivedPane onOpenThread={onClose} />}
            {active === "diagnostics" && <DiagnosticsPane env={env} />}
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
  const { state, providerCatalog, updateDefaultRunConfig, setEditorCommand, setAskBeforeTools } =
    useStore();
  return (
    <Pane
      eyebrow="Run defaults"
      title="What every new thread starts with"
      description="These values seed the model picker on each new thread. Existing threads keep whatever they were last set to."
    >
      <Card>
        <RunControls
          runConfig={state.settings.defaults}
          enabledProviders={state.settings.enabledProviders}
          providerCatalog={providerCatalog}
          modelPreferences={state.settings.modelPreferences}
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
  const {
    overrides,
    customRules,
    configPath,
    loadError,
    setOverride,
    upsertCustomRule,
    removeCustomRule,
    revealFile,
  } = useKeybindings();
  const [query, setQuery] = useState("");
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
        <div className="flex flex-wrap items-start justify-between gap-3">
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
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
          <label className="min-w-[220px] flex-1">
            <span className="block font-mono text-[11px] italic text-ink-3">search</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter commands, keys, or when clauses"
              spellCheck={false}
              className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
            />
          </label>
          <div className="font-mono text-[11px] text-ink-3">
            {filteredShortcutCount(query, overrides)} matching binding{filteredShortcutCount(query, overrides) === 1 ? "" : "s"}
          </div>
        </div>
      </Card>
      <CustomKeybindingRulesCard
        rules={customRules}
        onAdd={(rule) => void upsertCustomRule(rule)}
        onRemove={(index) => void removeCustomRule(index)}
      />
      {groups.map((g) => (
        <ShortcutGroupCard
          key={g.scope}
          group={g}
          query={query}
          overrides={overrides}
          onSave={(id, spec) => void setOverride(id, spec)}
        />
      ))}
    </Pane>
  );
}

const KEYBINDING_COMMAND_OPTIONS = Array.from(
  new Set(
    SHORTCUTS
      .filter((shortcut) => !NON_CONFIGURABLE_IDS.has(shortcut.id))
      .map((shortcut) => shortcut.command),
  ),
).sort() as KeybindingCommand[];

const WHEN_SUGGESTIONS = [
  "terminalFocus",
  "!terminalFocus",
  "terminalOpen",
  "terminalOpen && !terminalFocus",
  "modelPickerOpen",
  "!modelPickerOpen",
];

function CustomKeybindingRulesCard({
  rules,
  onAdd,
  onRemove,
}: {
  rules: KeybindingRule[];
  onAdd: (rule: KeybindingRule) => void;
  onRemove: (index: number) => void;
}) {
  const [command, setCommand] = useState<KeybindingCommand>(
    KEYBINDING_COMMAND_OPTIONS[0] ?? "commandPalette.toggle",
  );
  const [key, setKey] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanKey = key.trim();
    const cleanWhen = when.trim();
    if (!cleanKey || !parseKey(cleanKey)) {
      setError("Enter a valid key such as mod+j or ctrl+alt+t.");
      return;
    }
    onAdd({
      key: cleanKey,
      command,
      ...(cleanWhen ? { when: cleanWhen } : {}),
    });
    setKey("");
    setWhen("");
    setError(null);
  };

  return (
    <Card padded={false}>
      <div className="border-b border-rule px-5 py-3">
        <div className="font-mono text-[11px] italic text-ink-3">rules</div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14.5px] text-ink">Custom rules</h3>
          <span className="font-mono text-[10.5px] text-ink-3">
            {rules.length} saved
          </span>
        </div>
      </div>
      <form
        onSubmit={submit}
        className="grid gap-2 border-b border-rule px-5 py-3 md:grid-cols-[1.2fr_0.9fr_1fr_auto]"
      >
        <label className="min-w-0">
          <span className="block font-mono text-[10.5px] italic text-ink-3">command</span>
          <select
            value={command}
            onChange={(event) => setCommand(event.target.value as KeybindingCommand)}
            className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 font-mono text-[12px] text-ink outline-none focus:border-rule-strong"
          >
            {KEYBINDING_COMMAND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="block font-mono text-[10.5px] italic text-ink-3">key</span>
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="mod+j"
            spellCheck={false}
            className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
          />
        </label>
        <label className="min-w-0">
          <span className="block font-mono text-[10.5px] italic text-ink-3">when</span>
          <input
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            list="keybinding-when-suggestions"
            placeholder="optional"
            spellCheck={false}
            className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
          />
          <datalist id="keybinding-when-suggestions">
            {WHEN_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-8 whitespace-nowrap rounded-md border border-accent/50 bg-accent-soft/60 px-3 text-[12px] text-accent-deep transition-colors hover:bg-accent-soft"
          >
            Add rule
          </button>
        </div>
        {error && (
          <div className="text-[12px] text-error md:col-span-4">{error}</div>
        )}
      </form>
      {rules.length === 0 ? (
        <p className="px-5 py-5 text-[12px] text-ink-3">
          No custom rules saved in keybindings.json.
        </p>
      ) : (
        <ul className="divide-y divide-rule/60">
          {rules.map((rule, index) => (
            <li
              key={`${rule.command}:${rule.key}:${rule.when ?? ""}:${index}`}
              className="flex items-center justify-between gap-3 px-5 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] text-ink-2">
                  {rule.command}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-3">
                  when: {rule.when ?? "always"}
                </span>
              </span>
              <kbd className="shrink-0 rounded-sm border border-rule bg-surface/50 px-2 py-0.5 font-mono text-[11px] text-ink">
                {formatKeys(rule.key)}
              </kbd>
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Delete custom keybinding ${rule.command}`}
                className="shrink-0 rounded-md border border-rule bg-canvas px-2 py-0.5 text-[11px] text-ink-3 transition-colors hover:border-del/50 hover:bg-del/10 hover:text-del"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ShortcutGroupCard({
  group,
  query,
  overrides,
  onSave,
}: {
  group: { scope: ShortcutScope; title: string; description: string };
  query: string;
  overrides: Record<string, string>;
  onSave: (id: string, spec: string | null) => void;
}) {
  const shortcuts = SHORTCUTS.filter((shortcut) =>
    shortcut.scope === group.scope && shortcutMatchesQuery(shortcut, overrides[shortcut.id], query),
  );
  return (
    <Card padded={false}>
      <div className="border-b border-rule px-5 py-3">
        <div className="font-mono text-[11px] italic text-ink-3">{group.title.toLowerCase()}</div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14.5px] text-ink">{group.title}</h3>
          <span className="font-mono text-[10.5px] text-ink-3">
            {shortcuts.length} shown
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-ink-3">{group.description}</p>
      </div>
      {shortcuts.length === 0 ? (
        <p className="px-5 py-5 text-[12px] text-ink-3">
          No bindings match this filter.
        </p>
      ) : (
        <ul className="divide-y divide-rule/60">
          {shortcuts.map((s) => (
            <ShortcutRow
              key={s.id}
              id={s.id}
              description={s.description}
              defaultKeys={s.keys}
              overrideKeys={overrides[s.id]}
              editable={!NON_CONFIGURABLE_IDS.has(s.id)}
              onSave={(spec) => onSave(s.id, spec)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function filteredShortcutCount(query: string, overrides: Record<string, string>): number {
  return SHORTCUTS.filter((shortcut) =>
    shortcutMatchesQuery(shortcut, overrides[shortcut.id], query),
  ).length;
}

function shortcutMatchesQuery(
  shortcut: (typeof SHORTCUTS)[number],
  overrideKeys: string | undefined,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    shortcut.id,
    shortcut.command,
    shortcut.description,
    shortcut.scope,
    shortcut.keys,
    overrideKeys ?? "",
    shortcut.when ?? "",
  ].join(" ").toLowerCase();
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
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
  const {
    state,
    providerCatalog,
    refreshProviderCatalog,
    setProviderEnabled,
    updateModelPreferences,
    updateProviderRuntime,
  } = useStore();
  return (
    <Pane
      eyebrow="Providers"
      title="Which agents are available"
      description="Runtime providers are added to the picker only after their local CLI reports a usable login and models."
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-ink-3">
          OpenCode connected providers: {providerCatalog.opencode.connectedProviderIds.length}
          {" · "}
          Cursor: {providerCatalog.cursor?.available ? "connected" : "not connected"}
        </span>
        <button
          type="button"
          onClick={() => void refreshProviderCatalog()}
          className="rounded-md border border-rule bg-canvas px-2.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
        >
          Refresh
        </button>
      </div>
      <ul className="divide-y divide-rule rounded-lg border border-rule bg-canvas">
        {PROVIDERS.map((id) => {
          const meta = PROVIDER_META[id];
          const planned = meta.status === "planned";
          const opencodeBlocked = id === "opencode" && !providerCatalog.opencode.available;
          const cursorBlocked = id === "cursor" && !providerCatalog.cursor?.available;
          const disabled = planned || opencodeBlocked || cursorBlocked;
          const badge = providerBadge(id, planned, providerCatalog);
          const preferences = modelPreferencesForProvider(state.settings.modelPreferences, id);
          const providerModels = settingsModelsForProvider(id, providerCatalog, preferences);
          return (
            <li
              key={id}
              className="space-y-4 px-5 py-4"
            >
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <ProviderIcon id={id} planned={planned} />
                    <span className="text-[13.5px] font-medium text-ink">{meta.label}</span>
                    {badge && (
                      <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] italic text-ink-3">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="max-w-md text-[12.5px] leading-relaxed text-ink-3">
                    {providerDescription(id, meta.description, providerCatalog)}
                  </p>
                </div>
                <Toggle
                  checked={!disabled && state.settings.enabledProviders[id]}
                  disabled={disabled}
                  onChange={(v) => setProviderEnabled(id as ProviderId, v)}
                />
              </div>
              <ProviderRuntimeEditor
                provider={id}
                value={state.settings.providerRuntime[id] ?? {}}
                onChange={(config) => updateProviderRuntime(id, config)}
              />
              {!disabled && (
                <ProviderModelPreferencesEditor
                  provider={id}
                  models={providerModels}
                  preferences={preferences}
                  onChange={(next) => updateModelPreferences(id, next)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Pane>
  );
}

function ProviderRuntimeEditor({
  provider,
  value,
  onChange,
}: {
  provider: ProviderId;
  value: ProviderRuntimeConfig;
  onChange: (config: Partial<ProviderRuntimeConfig>) => void;
}) {
  const fields = runtimeFieldsForProvider(provider);
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-3 border-t border-rule pt-3 sm:grid-cols-2">
      {fields.map((field) => (
        <label key={field.key} className={field.wide ? "block sm:col-span-2" : "block"}>
          <span className="block font-mono text-[11px] italic text-ink-3">{field.label}</span>
          <input
            type={field.secret ? "password" : "text"}
            value={stringRuntimeValue(value[field.key])}
            onChange={(event) => onChange({ [field.key]: event.target.value })}
            placeholder={field.placeholder}
            spellCheck={false}
            className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
          />
        </label>
      ))}
    </div>
  );
}

function runtimeFieldsForProvider(provider: ProviderId): Array<{
  key: keyof ProviderRuntimeConfig;
  label: string;
  placeholder: string;
  secret?: boolean;
  wide?: boolean;
}> {
  switch (provider) {
    case "claude":
      return [
        { key: "binaryPath", label: "binary", placeholder: "claude" },
        { key: "homePath", label: "home", placeholder: "~" },
        { key: "launchArgs", label: "launch args", placeholder: "--chrome", wide: true },
      ];
    case "codex":
      return [
        { key: "binaryPath", label: "binary", placeholder: "codex" },
        { key: "homePath", label: "CODEX_HOME", placeholder: "~/.codex" },
        { key: "shadowHomePath", label: "shadow home", placeholder: "~/.codex-work", wide: true },
      ];
    case "opencode":
      return [
        { key: "binaryPath", label: "binary", placeholder: "opencode" },
        { key: "serverUrl", label: "server URL", placeholder: "http://127.0.0.1:4096" },
        { key: "serverPassword", label: "server password", placeholder: "optional", secret: true, wide: true },
      ];
    case "cursor":
      return [
        { key: "binaryPath", label: "binary", placeholder: "agent" },
        { key: "apiEndpoint", label: "API endpoint", placeholder: "https://...", wide: true },
      ];
    default:
      return [];
  }
}

function stringRuntimeValue(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function SourceControlPane() {
  const { state } = useStore();
  const selectedThreadId = state.selectedThreadId;
  const selectedProjectId = state.selectedProjectId;
  let activeProject: (typeof state.projects)[number] | null = selectedProjectId
    ? state.projects.find((project) => project.id === selectedProjectId) ?? null
    : null;
  let activeThread: (typeof state.projects)[number]["threads"][number] | null = null;
  if (selectedThreadId) {
    for (const project of state.projects) {
      const thread = project.threads.find((entry) => entry.id === selectedThreadId);
      if (thread) {
        activeProject = project;
        activeThread = thread;
        break;
      }
    }
  }
  const cwd = activeProject && activeThread
    ? threadCwd(activeProject, activeThread)
    : (activeProject?.path ?? "");
  const [scan, setScan] = useState<SourceControlScanResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    void window.api.project
      .sourceControlScan(cwd ? { projectPath: cwd } : undefined)
      .then(setScan)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    window.api.project
      .sourceControlScan(cwd ? { projectPath: cwd } : undefined)
      .then((next) => {
        if (mounted) setScan(next);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [cwd]);

  const ok = scan?.ok === true ? scan : null;
  return (
    <Pane
      eyebrow="Source control"
      title="Git hosting on this machine"
      description="Checks git remotes and local provider auth for the active checkout."
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] italic text-ink-3">active checkout</div>
            <p className="mt-1 truncate font-mono text-[12px] text-ink">
              {cwd || "No project selected"}
            </p>
            {ok && (
              <p className="mt-1 text-[11.5px] text-ink-3">
                checked {new Date(ok.checkedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-md border border-rule bg-canvas px-2.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            {loading ? "Scanning" : "Rescan"}
          </button>
        </div>
        {scan && !scan.ok && (
          <p className="mt-3 rounded-md border border-error/35 bg-error-soft/60 px-3 py-2 text-[12px] text-error">
            {scan.error}
          </p>
        )}
      </Card>

      {ok && (
        <>
          {ok.isRepo && (
            <PublishRepositoryCard
              cwd={cwd}
              providers={ok.providers}
              onPublished={refresh}
            />
          )}

          <Card padded={false}>
            <div className="border-b border-rule px-5 py-3">
              <div className="font-mono text-[11px] italic text-ink-3">remotes</div>
              <h3 className="mt-1 text-[14.5px] text-ink">
                {ok.isRepo ? `${ok.remotes.length} git remote${ok.remotes.length === 1 ? "" : "s"}` : "Not a git repository"}
              </h3>
            </div>
            {ok.remotes.length === 0 ? (
              <p className="px-5 py-4 text-[12px] text-ink-3">
                {ok.isRepo ? "No remotes configured for this checkout." : "Choose a git repository to see its remotes."}
              </p>
            ) : (
              <ul className="divide-y divide-rule/60">
                {ok.remotes.map((remote) => (
                  <li key={`${remote.name}-${remote.url}`} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-ink">{remote.name}</span>
                          <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] italic text-ink-3">
                            {sourceProviderLabel(remote.provider)}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-3">
                          {remote.url}
                        </p>
                      </div>
                      <span className="max-w-[180px] truncate text-right font-mono text-[11px] text-ink-3">
                        {[remote.owner, remote.repo].filter(Boolean).join("/") || remote.host || "unknown"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false}>
            <div className="border-b border-rule px-5 py-3">
              <div className="font-mono text-[11px] italic text-ink-3">providers</div>
              <h3 className="mt-1 text-[14.5px] text-ink">Source control providers</h3>
            </div>
            <ul className="divide-y divide-rule/60">
              {ok.providers.map((provider) => (
                <SourceControlProviderRow key={provider.kind} provider={provider} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </Pane>
  );
}

function SourceControlProviderRow({
  provider,
}: {
  provider: SourceControlProviderDiscovery;
}) {
  const status = sourceAuthLabel(provider);
  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${sourceStatusDot(provider)}`} />
            <span className="text-[13.5px] font-medium text-ink">{provider.label}</span>
            <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] italic text-ink-3">
              {provider.executable ?? "env"}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            {status}
            {provider.account ? (
              <>
                {" "}
                <span className="font-mono text-ink-2">{provider.account}</span>
              </>
            ) : null}
          </p>
          {!provider.available || provider.authStatus !== "authenticated" ? (
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
              {provider.available ? provider.authHint : provider.installHint}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 shrink-0 text-left sm:text-right">
          <div className="font-mono text-[11px] text-ink-2">
            {provider.matchedRemotes.length} remote
            {provider.matchedRemotes.length === 1 ? "" : "s"}
          </div>
          {provider.version ? (
            <div className="mt-1 max-w-[180px] truncate font-mono text-[10.5px] text-ink-3">
              {provider.version}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ArchivedPane({ onOpenThread }: { onOpenThread: () => void }) {
  const { state, selectThread, setThreadArchived, deleteThread } = useStore();
  const archived = collectArchivedSettingsThreads(state.projects);
  return (
    <Pane
      eyebrow="Archived"
      title="Threads out of the active list"
      description="Review older threads without mixing them back into project navigation."
    >
      <Card padded={false}>
        <div className="border-b border-rule px-5 py-3">
          <div className="font-mono text-[11px] italic text-ink-3">threads</div>
          <h3 className="mt-1 text-[14.5px] text-ink">
            {archived.length} archived thread{archived.length === 1 ? "" : "s"}
          </h3>
        </div>
        {archived.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-rule bg-surface text-ink-3">
              <ArchiveIcon size={15} />
            </div>
            <p className="mt-3 text-[13px] text-ink-2">No archived threads.</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Archive threads from the sidebar or composer command menu.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-rule/60">
            {archived.map(({ project, thread }) => (
              <li key={thread.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <button
                  type="button"
                  onClick={() => {
                    selectThread(thread.id);
                    onOpenThread();
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">
                      {truncate(thread.title || "Untitled thread", 80)}
                    </span>
                    {state.selectedThreadId === thread.id && (
                      <span className="shrink-0 rounded-sm border border-rule px-1.5 py-px font-mono text-[10px] italic text-ink-3">
                        selected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[12px] text-ink-3">
                    {project.name} - archived {relativeTime(thread.archivedAt ?? thread.updatedAt)}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
                    {threadCwd(project, thread)}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <ArchivedAction
                    label="Restore"
                    onClick={() => setThreadArchived(thread.id, false)}
                  >
                    <RestoreIcon size={12} />
                  </ArchivedAction>
                  <ArchivedAction
                    label="Delete"
                    danger
                    onClick={() => {
                      if (window.confirm(`Delete archived thread "${thread.title || "Untitled thread"}"?`)) {
                        deleteThread(thread.id);
                      }
                    }}
                  >
                    <TrashIcon size={12} />
                  </ArchivedAction>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Note>
        Restoring a thread returns it to its original project. Opening a thread switches
        back to chat and keeps its archived state unchanged.
      </Note>
    </Pane>
  );
}

function ArchivedAction({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
        danger
          ? "border-error/35 bg-error-soft/40 text-error hover:border-error/60"
          : "border-rule bg-canvas text-ink-2 hover:border-rule-strong hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function collectArchivedSettingsThreads(projects: ReturnType<typeof useStore>["state"]["projects"]) {
  return projects
    .flatMap((project) =>
      project.threads
        .filter((thread) => Boolean(thread.archivedAt))
        .map((thread) => ({ project, thread })),
    )
    .sort((a, b) => (b.thread.archivedAt ?? 0) - (a.thread.archivedAt ?? 0));
}

function PublishRepositoryCard({
  cwd,
  providers,
  onPublished,
}: {
  cwd: string;
  providers: SourceControlProviderDiscovery[];
  onPublished: () => void;
}) {
  const readyProviders = providers.filter(isPublishProviderReady);
  const firstProvider = readyProviders[0]?.kind ?? "github";
  const [provider, setProvider] = useState<"github" | "gitlab" | "bitbucket" | "azure-devops">(firstProvider);
  const activeProvider = readyProviders.find((entry) => entry.kind === provider) ?? readyProviders[0];
  const selectedProvider = activeProvider?.kind ?? provider;
  const [repository, setRepository] = useState(() => defaultPublishRepository(cwd, activeProvider));
  const [visibility, setVisibility] = useState<SourceControlRepositoryVisibility>("private");
  const [remoteName, setRemoteName] = useState("origin");
  const [protocol, setProtocol] = useState<SourceControlCloneProtocol>("auto");
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProvider) return;
    setRepository((current) => current || defaultPublishRepository(cwd, activeProvider));
  }, [activeProvider, cwd]);

  const canPublish = Boolean(cwd && activeProvider && repository.trim() && remoteName.trim());

  const publish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    setMessage(null);
    setError(null);
    const result = await window.api.project.sourceControlPublishRepository({
      projectPath: cwd,
      provider: selectedProvider,
      repository,
      visibility,
      remoteName,
      protocol,
    });
    setPublishing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(
      result.status === "pushed"
        ? `Published ${result.repository.nameWithOwner} and pushed ${result.upstreamBranch ?? result.branch}.`
        : `Created ${result.repository.nameWithOwner} and added remote ${result.remoteName}.`,
    );
    onPublished();
  };

  return (
    <Card padded={false}>
      <div className="border-b border-rule px-5 py-3">
        <div className="font-mono text-[11px] italic text-ink-3">publish</div>
        <h3 className="mt-1 text-[14.5px] text-ink">Publish this repository</h3>
      </div>
      {readyProviders.length === 0 ? (
        <p className="px-5 py-4 text-[12px] leading-relaxed text-ink-3">
          Sign in to a source-control provider on this machine before publishing from debase.
        </p>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label className="block min-w-0">
              <span className="block font-mono text-[11px] italic text-ink-3">provider</span>
              <select
                value={selectedProvider}
                onChange={(event) => {
                  const next =
                    event.target.value === "gitlab"
                      ? "gitlab"
                      : event.target.value === "bitbucket"
                        ? "bitbucket"
                        : event.target.value === "azure-devops"
                          ? "azure-devops"
                          : "github";
                  setProvider(next);
                  const nextProvider = readyProviders.find((entry) => entry.kind === next);
                  setRepository(defaultPublishRepository(cwd, nextProvider));
                }}
                className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 text-[12.5px] text-ink outline-none focus:border-rule-strong"
              >
                {readyProviders.map((entry) => (
                  <option key={entry.kind} value={entry.kind}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="block font-mono text-[11px] italic text-ink-3">repository</span>
              <input
                type="text"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder="owner/name"
                spellCheck={false}
                className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
              />
            </label>
            <label className="block min-w-0">
              <span className="block font-mono text-[11px] italic text-ink-3">visibility</span>
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value === "public" ? "public" : "private")
                }
                className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 text-[12.5px] text-ink outline-none focus:border-rule-strong"
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
            <label className="block min-w-0">
              <span className="block font-mono text-[11px] italic text-ink-3">clone URL</span>
              <select
                value={protocol}
                onChange={(event) =>
                  setProtocol(event.target.value === "https" ? "https" : event.target.value === "ssh" ? "ssh" : "auto")
                }
                className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 text-[12.5px] text-ink outline-none focus:border-rule-strong"
              >
                <option value="auto">Auto</option>
                <option value="ssh">SSH</option>
                <option value="https">HTTPS</option>
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="block font-mono text-[11px] italic text-ink-3">remote</span>
              <input
                type="text"
                value={remoteName}
                onChange={(event) => setRemoteName(event.target.value)}
                spellCheck={false}
                className="mt-1 h-8 w-full rounded-md border border-rule bg-canvas px-2 font-mono text-[12.5px] text-ink outline-none focus:border-rule-strong"
              />
            </label>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!canPublish || publishing}
              className="h-8 w-full rounded-md border border-accent/50 bg-accent-soft/60 px-3 text-[12px] text-accent-deep transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {publishing ? "Publishing" : "Publish repository"}
            </button>
          </div>
          {message ? <p className="text-[12px] leading-relaxed text-add">{message}</p> : null}
          {error ? <p className="text-[12px] leading-relaxed text-error">{error}</p> : null}
        </div>
      )}
    </Card>
  );
}

function isPublishProviderReady(
  provider: SourceControlProviderDiscovery,
): provider is SourceControlProviderDiscovery & { kind: "github" | "gitlab" | "bitbucket" | "azure-devops" } {
  return (
    (provider.kind === "github" ||
      provider.kind === "gitlab" ||
      provider.kind === "bitbucket" ||
      provider.kind === "azure-devops") &&
    provider.available &&
    provider.authStatus === "authenticated"
  );
}

function defaultPublishRepository(
  cwd: string,
  provider:
    | (SourceControlProviderDiscovery & { kind: "github" | "gitlab" | "bitbucket" | "azure-devops" })
    | undefined,
): string {
  const projectName = cwd.split(/[\\/]/).filter(Boolean).pop() ?? "repository";
  const account = provider?.account?.trim();
  if (account && !account.includes("@")) return `${account}/${projectName}`;
  return projectName;
}

function sourceProviderLabel(provider: string): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azure-devops":
      return "Azure";
    default:
      return "unknown";
  }
}

function sourceAuthLabel(provider: SourceControlProviderDiscovery): string {
  if (!provider.available) return "Not available.";
  if (provider.authStatus === "authenticated") return "Authenticated";
  if (provider.authStatus === "unauthenticated") return "Not authenticated.";
  return "Status unknown.";
}

function sourceStatusDot(provider: SourceControlProviderDiscovery): string {
  if (!provider.available) return "bg-ink-4";
  if (provider.authStatus === "authenticated") return "bg-add";
  if (provider.authStatus === "unauthenticated") return "bg-error";
  return "bg-accent";
}

function ProviderModelPreferencesEditor({
  provider,
  models,
  preferences,
  onChange,
}: {
  provider: ProviderId;
  models: ModelInfo[];
  preferences: ProviderModelPreferences;
  onChange: (next: Partial<ProviderModelPreferences>) => void;
}) {
  const [customDraft, setCustomDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const favoriteSet = new Set(preferences.favoriteModels);
  const hiddenSet = new Set(preferences.hiddenModels);
  const builtInValues = new Set(models.map((model) => model.value));
  const canAddCustom = provider !== "opencode" && provider !== "cursor";

  const toggleFavorite = (model: string) => {
    onChange({
      favoriteModels: favoriteSet.has(model)
        ? preferences.favoriteModels.filter((value) => value !== model)
        : [...preferences.favoriteModels, model],
    });
  };

  const toggleHidden = (model: string) => {
    onChange({
      hiddenModels: hiddenSet.has(model)
        ? preferences.hiddenModels.filter((value) => value !== model)
        : [...preferences.hiddenModels, model],
    });
  };

  const addCustom = () => {
    const slug = normalizeCustomModelSlug(customDraft);
    if (!slug) {
      setError("Use a non-empty model slug without spaces.");
      return;
    }
    if (builtInValues.has(slug)) {
      setError("That model is already listed.");
      return;
    }
    if (preferences.customModels.includes(slug)) {
      setError("That custom model is already saved.");
      return;
    }
    onChange({ customModels: [...preferences.customModels, slug] });
    setCustomDraft("");
    setError(null);
  };

  const removeCustom = (model: string) => {
    onChange({
      customModels: preferences.customModels.filter((value) => value !== model),
      favoriteModels: preferences.favoriteModels.filter((value) => value !== model),
      hiddenModels: preferences.hiddenModels.filter((value) => value !== model),
    });
  };

  return (
    <div className="rounded-md border border-rule/70 bg-surface/30">
      <div className="flex items-center justify-between gap-3 border-b border-rule/70 px-3 py-2">
        <span className="font-mono text-[11px] italic text-ink-3">models</span>
        <span className="font-mono text-[10.5px] text-ink-3">
          {preferences.favoriteModels.length} favorite
          {preferences.favoriteModels.length === 1 ? "" : "s"}
          {" · "}
          {preferences.hiddenModels.length} hidden
        </span>
      </div>
      <div className="max-h-64 divide-y divide-rule/60 overflow-y-auto">
        {models.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-ink-3">
            No models available from this provider.
          </div>
        ) : (
          models.map((model) => {
            const favorite = favoriteSet.has(model.value);
            const hidden = hiddenSet.has(model.value);
            const custom = preferences.customModels.includes(model.value);
            return (
              <div
                key={model.value}
                className={`flex items-center gap-2 px-3 py-2 ${hidden ? "opacity-55" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-ink-2">{model.displayName}</div>
                  <div className="truncate font-mono text-[10.5px] text-ink-3">
                    {model.value}
                  </div>
                </div>
                {custom && (
                  <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10px] italic text-ink-3">
                    custom
                  </span>
                )}
                {hidden && (
                  <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10px] italic text-ink-3">
                    hidden
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleFavorite(model.value)}
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[10.5px] transition-colors ${
                    favorite
                      ? "border-accent/50 bg-accent-soft/60 text-accent-deep"
                      : "border-rule bg-canvas text-ink-3 hover:bg-surface hover:text-ink-2"
                  }`}
                >
                  fav
                </button>
                {!custom && (
                  <button
                    type="button"
                    onClick={() => toggleHidden(model.value)}
                    className="rounded-sm border border-rule bg-canvas px-2 py-0.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
                  >
                    {hidden ? "show" : "hide"}
                  </button>
                )}
                {custom && (
                  <button
                    type="button"
                    onClick={() => removeCustom(model.value)}
                    title="Remove custom model"
                    aria-label={`Remove ${model.value}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-rule bg-canvas text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
                  >
                    <CloseIcon size={11} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      {canAddCustom ? (
        <div className="space-y-1.5 border-t border-rule/70 px-3 py-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={customDraft}
              onChange={(event) => {
                setCustomDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder={provider === "claude" ? "claude-custom-model" : "gpt-custom-model"}
              spellCheck={false}
              className="h-7 min-w-0 flex-1 rounded-sm border border-rule bg-canvas px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-rule-strong"
            />
            <button
              type="button"
              onClick={addCustom}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-canvas px-2.5 text-[11.5px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
            >
              <PlusIcon size={11} />
              add
            </button>
          </div>
          {error ? <p className="text-[11.5px] text-error">{error}</p> : null}
        </div>
      ) : (
        <div className="border-t border-rule/70 px-3 py-2 text-[11.5px] text-ink-3">
          OpenCode models come only from the local OpenCode catalog.
        </div>
      )}
    </div>
  );
}

function settingsModelsForProvider(
  provider: ProviderId,
  providerCatalog: Parameters<typeof modelsForProvider>[1],
  preferences: ProviderModelPreferences,
): ModelInfo[] {
  const base = modelsForProvider(provider, providerCatalog);
  if (provider === "opencode" || provider === "cursor") return base;
  const baseValues = new Set(base.map((model) => model.value));
  const custom = preferences.customModels
    .filter((slug) => !baseValues.has(slug))
    .map((slug): ModelInfo => ({
      value: slug,
      provider,
      displayName: slug,
      description: "User-added custom model slug.",
      context: 200_000,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      supportsAdaptiveThinking: provider === "claude",
    }));
  return [...base, ...custom];
}

function providerBadge(
  id: ProviderId,
  planned: boolean,
  catalog: Parameters<typeof modelsForProvider>[1],
): string | null {
  if (planned) return "planned";
  if (id === "opencode") {
    const opencode = catalog?.opencode;
    if (!opencode?.installed) return "not installed";
    if (!opencode.available) return "not connected";
    return `${opencode.models.length} models`;
  }
  if (id === "cursor") {
    const cursor = catalog?.cursor;
    if (!cursor?.installed) return "not installed";
    if (!cursor.available) return "not connected";
    return `${cursor.models.length} models`;
  }
  return null;
}

function providerDescription(
  id: ProviderId,
  fallback: string,
  catalog: Parameters<typeof modelsForProvider>[1],
): string {
  if (id === "cursor") {
    const cursor = catalog?.cursor;
    if (!cursor?.installed) {
      return "Install Cursor CLI so the agent command is available on PATH.";
    }
    if (!cursor.available) {
      return cursor.error ?? "Run agent login, then refresh providers.";
    }
    return cursor.status ?? "Cursor CLI is authenticated.";
  }
  if (id !== "opencode") return fallback;
  const opencode = catalog?.opencode;
  if (!opencode?.installed) return "Install opencode and make sure it is on PATH.";
  if (!opencode.available) {
    return opencode.error ?? "Run opencode auth login, then refresh providers.";
  }
  return `Connected through ${opencode.connectedProviderIds.join(", ")}.`;
}

function DiagnosticsPane({ env }: { env: EnvironmentInfo | null }) {
  const { state, providerCatalog, refreshProviderCatalog } = useStore();
  const { configPath, loadError, revealFile } = useKeybindings();
  const cwd = activeSettingsCwd(state);
  const [skills, setSkills] = useState<ProjectListSkillsResponse | null>(null);
  const [source, setSource] = useState<SourceControlScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const refresh = () => {
    setLoading(true);
    void Promise.allSettled([
      refreshProviderCatalog(),
      window.api.project.listSkills({ projectPath: cwd || undefined }).then(setSkills),
      window.api.project.sourceControlScan(cwd ? { projectPath: cwd } : undefined).then(setSource),
    ]).finally(() => {
      setCheckedAt(Date.now());
      setLoading(false);
    });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const running = Object.keys(state.pendings).length;
  const queued = state.projects.flatMap((project) => project.threads).filter((thread) => thread.queuedPrompt).length;
  const opencode = providerCatalog.opencode;
  const cursor = providerCatalog.cursor;
  const sourceOk = source?.ok === true ? source : null;
  const skillCount = skills?.ok ? skills.skills.length : 0;
  const diagnostics = {
    checkedAt,
    cwd,
    env,
    providerCatalog,
    skills,
    source,
    keybindings: { configPath, loadError },
    state: {
      projects: state.projects.length,
      threads: state.projects.reduce((sum, project) => sum + project.threads.length, 0),
      running,
      queued,
    },
  };

  return (
    <Pane
      eyebrow="Diagnostics"
      title="Current app health"
      description="One place to confirm provider catalogs, local skills, keybindings, source-control auth, and the active working directory."
    >
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] italic text-ink-3">active cwd</div>
            <p className="mt-1 truncate font-mono text-[12px] text-ink">
              {cwd || "No project selected"}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-3">
              {checkedAt ? `checked ${new Date(checkedAt).toLocaleTimeString()}` : "not checked yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex h-7 items-center rounded-md border border-rule bg-canvas px-3 text-[12px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              {loading ? "Checking" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))}
              className="inline-flex h-7 items-center rounded-md border border-rule bg-canvas px-3 text-[12px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
            >
              Copy snapshot
            </button>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <div className="border-b border-rule px-5 py-3">
          <div className="font-mono text-[11px] italic text-ink-3">checks</div>
          <h3 className="mt-1 text-[14.5px] text-ink">Runtime status</h3>
        </div>
        <div className="divide-y divide-rule/60">
          <DiagnosticRow
            label="Environment"
            tone={env ? "ok" : "warn"}
            detail={env ? `${env.platform} · debase ${env.appVersion}` : "Environment info has not loaded."}
          />
          <DiagnosticRow
            label="OpenCode catalog"
            tone={!opencode.installed ? "warn" : opencode.available ? "ok" : "error"}
            detail={
              !opencode.installed
                ? "opencode CLI is not installed or not on PATH."
                : opencode.available
                  ? `${opencode.models.length} models from ${opencode.connectedProviderIds.join(", ")}`
                  : opencode.error ?? "OpenCode is installed but not connected."
            }
          />
          <DiagnosticRow
            label="Cursor catalog"
            tone={!cursor?.installed ? "warn" : cursor.available ? "ok" : "error"}
            detail={
              !cursor?.installed
                ? "Cursor agent command is not installed or not on PATH."
                : cursor.available
                  ? `${cursor.models.length} models available`
                  : cursor.error ?? "Cursor agent is installed but not connected."
            }
          />
          <DiagnosticRow
            label="Local skills"
            tone={!skills ? "warn" : skills.ok && skillCount > 0 ? "ok" : "error"}
            detail={
              !skills
                ? "Skill scan has not completed."
                : skills.ok
                  ? `${skillCount} installed skills found`
                  : skills.error
            }
          />
          <DiagnosticRow
            label="Source control"
            tone={!source ? "warn" : source.ok && source.isRepo ? "ok" : source.ok ? "warn" : "error"}
            detail={
              !source
                ? "Source-control scan has not completed."
                : source.ok
                  ? source.isRepo
                    ? `${source.remotes.length} remotes · ${source.providers.filter((provider) => provider.authStatus === "authenticated").length} authenticated providers`
                    : "Active cwd is not a git repository."
                  : source.error
            }
          />
          <DiagnosticRow
            label="Keybindings"
            tone={loadError ? "error" : "ok"}
            detail={loadError ?? (configPath || "Default keybindings only.")}
            action={configPath ? () => void revealFile() : undefined}
          />
        </div>
      </Card>

      <Card padded={false}>
        <div className="grid grid-cols-2 gap-0 text-[12px] sm:grid-cols-4">
          <Metric label="projects" value={String(state.projects.length)} />
          <Metric
            label="threads"
            value={String(state.projects.reduce((sum, project) => sum + project.threads.length, 0))}
          />
          <Metric label="running" value={String(running)} />
          <Metric label="queued" value={String(queued)} />
        </div>
      </Card>

      {sourceOk && (
        <Note>
          Source-control providers:{" "}
          <span className="font-mono text-ink-2">
            {sourceOk.providers.map((provider) => `${provider.kind}:${provider.authStatus}`).join(" · ")}
          </span>
        </Note>
      )}
    </Pane>
  );
}

function activeSettingsCwd(state: ReturnType<typeof useStore>["state"]): string {
  let activeProject = state.selectedProjectId
    ? state.projects.find((project) => project.id === state.selectedProjectId) ?? null
    : null;
  let activeThread: (typeof state.projects)[number]["threads"][number] | null = null;
  if (state.selectedThreadId) {
    for (const project of state.projects) {
      const thread = project.threads.find((entry) => entry.id === state.selectedThreadId);
      if (thread) {
        activeProject = project;
        activeThread = thread;
        break;
      }
    }
  }
  return activeProject && activeThread
    ? threadCwd(activeProject, activeThread)
    : (activeProject?.path ?? "");
}

function DiagnosticRow({
  label,
  detail,
  tone,
  action,
}: {
  label: string;
  detail: string;
  tone: "ok" | "warn" | "error";
  action?: () => void;
}) {
  const color =
    tone === "ok" ? "bg-add" : tone === "warn" ? "bg-accent" : "bg-error";
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${color}`} />
          <span className="text-[13px] font-medium text-ink">{label}</span>
        </div>
        <p className="mt-1 truncate text-[12px] text-ink-3">{detail}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={action}
          className="shrink-0 rounded-md border border-rule bg-canvas px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
        >
          Open
        </button>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-b border-rule/60 px-5 py-4 last:border-r-0 sm:border-b-0">
      <div className="font-mono text-[10.5px] italic text-ink-3">{label}</div>
      <div className="mt-1 font-mono text-[18px] text-ink">{value}</div>
    </div>
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
        Claude authenticates through your <span className="font-mono text-ink-2">claude</span>{" "}
        CLI login. Codex authenticates through your{" "}
        <span className="font-mono text-ink-2">codex</span> CLI login.
      </Note>
    </Pane>
  );
}

function AboutPane() {
  return (
    <Pane
      eyebrow="About"
      title="debase"
      description="A desktop shell that wraps Claude Code, OpenAI Codex, OpenCode, and Cursor CLI into one interface. Threads are organised by project, the project's path becomes the agent's working directory, and the underlying CLI behavior is left untouched."
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
            electron-vite · React 19 · Tailwind 4 · Claude Agent SDK · Codex CLI.
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
  // Codex/OpenCode use compact marks that keep the provider row visually
  // distinct without pulling in an icon library.
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
  if (id === "cursor") {
    return (
      <span className={tone}>
        <AgentIcon size={14} />
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

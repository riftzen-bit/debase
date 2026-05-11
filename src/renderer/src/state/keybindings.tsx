import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_KEYBINDING_RULES,
  NON_CONFIGURABLE_IDS,
  SHORTCUTS,
  keybindingCommandForEvent,
  ruleForShortcutId,
  sanitizeKeybindingRules,
  type KeybindingCommand,
  type KeybindingContext,
  type KeybindingRule,
} from "../lib/shortcuts";

type Overrides = Record<string, string>;

type KeybindingsContext = {
  /** Legacy remap UI state keyed by shortcut ID. Empty means use defaults. */
  overrides: Overrides;
  /** Raw file-backed rules from keybindings.json, before default rules are merged in. */
  customRules: KeybindingRule[];
  /** Effective command rules. Later matching rules win. */
  rules: KeybindingRule[];
  /** Filesystem path of the JSON config (used by Settings to surface it). */
  configPath: string;
  /** True until the renderer has heard back from the main process at boot. */
  loading: boolean;
  /** Last load error, if the file was malformed. Cleared on successful save. */
  loadError: string | null;
  /**
   * Persist a single override. Settings still works per shortcut row, but the
   * on-disk file is the t3code-style rule array: { key, command, when }.
   */
  setOverride: (id: string, spec: string | null) => Promise<void>;
  /** Add or move a raw file-backed rule to the end so it has highest precedence. */
  upsertCustomRule: (rule: KeybindingRule) => Promise<void>;
  /** Remove one raw file-backed rule by its current array index. */
  removeCustomRule: (index: number) => Promise<void>;
  commandForEvent: (
    event: KeyboardEvent | React.KeyboardEvent,
    context?: KeybindingContext,
  ) => KeybindingCommand | null;
  /** Open the JSON file in the user's default OS handler. */
  revealFile: () => Promise<void>;
};

const Ctx = createContext<KeybindingsContext | null>(null);

export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [customRules, setCustomRules] = useState<KeybindingRule[]>([]);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.keybindings.load().then((res) => {
      if (cancelled) return;
      setConfigPath(res.path);
      if (res.ok) {
        const nextRules = sanitizeKeybindingRules(res.rules);
        setOverrides({ ...overridesFromRules(nextRules), ...res.overrides });
        setCustomRules(nextRules);
        setLoadError(null);
      } else {
        setOverrides({});
        setCustomRules([]);
        setLoadError(res.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setOverride = useCallback(
    async (id: string, spec: string | null) => {
      const next: Overrides = { ...overrides };
      if (spec === null) {
        delete next[id];
      } else {
        next[id] = spec;
      }
      const nextRules = mergeOverrideRules(customRules, next);

      setOverrides(next);
      setCustomRules(nextRules);
      const res = await window.api.keybindings.save({ overrides: next, rules: nextRules });
      if (!res.ok) {
        setOverrides(overrides);
        setCustomRules(customRules);
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
    },
    [customRules, overrides],
  );

  const upsertCustomRule = useCallback(
    async (rule: KeybindingRule) => {
      const [clean] = sanitizeKeybindingRules([rule]);
      if (!clean) {
        setLoadError("Invalid keybinding rule.");
        return;
      }

      const nextRules = [
        ...customRules.filter((entry) => !sameRule(entry, clean)),
        clean,
      ];
      const nextOverrides = overridesFromRules(nextRules);

      setCustomRules(nextRules);
      setOverrides(nextOverrides);
      const res = await window.api.keybindings.save({
        overrides: nextOverrides,
        rules: nextRules,
      });
      if (!res.ok) {
        setCustomRules(customRules);
        setOverrides(overrides);
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
    },
    [customRules, overrides],
  );

  const removeCustomRule = useCallback(
    async (index: number) => {
      if (!Number.isInteger(index) || index < 0 || index >= customRules.length) {
        setLoadError("Invalid keybinding rule index.");
        return;
      }
      const nextRules = customRules.filter((_, i) => i !== index);
      const nextOverrides = overridesFromRules(nextRules);

      setCustomRules(nextRules);
      setOverrides(nextOverrides);
      const res = await window.api.keybindings.save({
        overrides: nextOverrides,
        rules: nextRules,
      });
      if (!res.ok) {
        setCustomRules(customRules);
        setOverrides(overrides);
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
    },
    [customRules, overrides],
  );

  const revealFile = useCallback(async () => {
    await window.api.keybindings.revealFile();
  }, []);

  const rules = useMemo(
    () => mergeRules(customRules, overrides),
    [customRules, overrides],
  );

  const commandForEvent = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent, context: KeybindingContext = {}) =>
      keybindingCommandForEvent(event, rules, context),
    [rules],
  );

  const value = useMemo<KeybindingsContext>(
    () => ({
      overrides,
      customRules,
      rules,
      configPath,
      loading,
      loadError,
      setOverride,
      upsertCustomRule,
      removeCustomRule,
      commandForEvent,
      revealFile,
    }),
    [
      overrides,
      customRules,
      rules,
      configPath,
      loading,
      loadError,
      setOverride,
      upsertCustomRule,
      removeCustomRule,
      commandForEvent,
      revealFile,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeybindings(): KeybindingsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKeybindings must be inside <KeybindingsProvider>");
  return ctx;
}

export function useShortcutOverrides(): Overrides {
  return useKeybindings().overrides;
}

export function useKeybindingRules(): KeybindingRule[] {
  return useKeybindings().rules;
}

export function useCommandForEvent(): KeybindingsContext["commandForEvent"] {
  return useKeybindings().commandForEvent;
}

function mergeRules(customRules: KeybindingRule[], overrides: Overrides): KeybindingRule[] {
  const overrideRules = buildOverrideRules(overrides);
  if (customRules.length === 0 && overrideRules.length === 0) {
    return DEFAULT_KEYBINDING_RULES;
  }
  const overriddenCommands = new Set(
    [...customRules, ...overrideRules].map((rule) => rule.command),
  );
  return [
    ...DEFAULT_KEYBINDING_RULES.filter((rule) => !overriddenCommands.has(rule.command)),
    ...customRules,
    ...overrideRules,
  ];
}

function mergeOverrideRules(customRules: KeybindingRule[], overrides: Overrides): KeybindingRule[] {
  const overrideRules = buildOverrideRules(overrides);
  const overrideCommands = new Set(overrideRules.map((rule) => rule.command));
  return [
    ...customRules.filter((rule) => !overrideCommands.has(rule.command)),
    ...overrideRules,
  ];
}

function buildOverrideRules(overrides: Overrides): KeybindingRule[] {
  return Object.entries(overrides).flatMap(([id, spec]) => {
    if (spec.length === 0) return [];
    const rule = ruleForShortcutId(id, spec);
    return rule ? [rule] : [];
  });
}

function sameRule(left: KeybindingRule, right: KeybindingRule): boolean {
  return (
    left.key === right.key &&
    left.command === right.command &&
    (left.when ?? "") === (right.when ?? "")
  );
}

function overridesFromRules(rules: KeybindingRule[]): Overrides {
  const overrides: Overrides = {};
  for (const shortcut of SHORTCUTS) {
    if (NON_CONFIGURABLE_IDS.has(shortcut.id)) continue;
    let match: KeybindingRule | undefined;
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (
        rule.command === shortcut.command &&
        (rule.when ?? "") === (shortcut.when ?? "")
      ) {
        match = rule;
        break;
      }
    }
    if (match && match.key !== shortcut.keys) {
      overrides[shortcut.id] = match.key;
    }
  }
  return overrides;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Overrides = Record<string, string>;

type KeybindingsContext = {
  /** Current user overrides keyed by shortcut ID. Empty means use defaults. */
  overrides: Overrides;
  /** Filesystem path of the JSON config (used by Settings to surface it). */
  configPath: string;
  /** True until the renderer has heard back from the main process at boot. */
  loading: boolean;
  /** Last load error, if the file was malformed. Cleared on successful save. */
  loadError: string | null;
  /**
   * Persist a single override. Pass empty string to disable a binding entirely
   * (matches t3code's `"" disables this rule` convention). Pass `null` to
   * delete the override and fall back to the default.
   */
  setOverride: (id: string, spec: string | null) => Promise<void>;
  /** Open the JSON file in the user's default OS handler. */
  revealFile: () => Promise<void>;
};

const Ctx = createContext<KeybindingsContext | null>(null);

export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.keybindings.load().then((res) => {
      if (cancelled) return;
      setConfigPath(res.path);
      if (res.ok) {
        setOverrides(res.overrides);
        setLoadError(null);
      } else {
        setOverrides({});
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
      // Optimistic update so the UI reflects immediately. We roll back if the
      // write fails (rare — usually disk full / permission).
      setOverrides(next);
      const res = await window.api.keybindings.save({ overrides: next });
      if (!res.ok) {
        setOverrides(overrides);
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
    },
    [overrides],
  );

  const revealFile = useCallback(async () => {
    await window.api.keybindings.revealFile();
  }, []);

  const value = useMemo<KeybindingsContext>(
    () => ({ overrides, configPath, loading, loadError, setOverride, revealFile }),
    [overrides, configPath, loading, loadError, setOverride, revealFile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeybindings(): KeybindingsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKeybindings must be inside <KeybindingsProvider>");
  return ctx;
}

/**
 * Lighter hook that just returns the overrides map — useful for components
 * that don't need to touch the admin surface (most shortcut handlers).
 */
export function useShortcutOverrides(): Overrides {
  return useKeybindings().overrides;
}

export type ShortcutScope = "global" | "chat" | "composer";

export type ShortcutBinding = {
  id: string;
  keys: string;
  description: string;
  scope: ShortcutScope;
};

export const SHORTCUTS: ShortcutBinding[] = [
  { id: "settings", keys: "mod+,", description: "Toggle settings", scope: "global" },
  { id: "shortcuts", keys: "mod+/", description: "Show keyboard shortcuts", scope: "global" },
  { id: "palette", keys: "mod+shift+p", description: "Command palette", scope: "global" },
  { id: "search", keys: "mod+k", description: "Focus thread search", scope: "global" },
  { id: "newThread", keys: "mod+shift+n", description: "New thread in current project", scope: "global" },
  { id: "sidebar", keys: "mod+b", description: "Toggle sidebar", scope: "global" },
  { id: "stop", keys: "mod+.", description: "Stop running stream", scope: "chat" },
  { id: "archiveThread", keys: "mod+w", description: "Archive current thread", scope: "chat" },
  { id: "prevThread", keys: "alt+arrowup", description: "Previous thread in project", scope: "chat" },
  { id: "nextThread", keys: "alt+arrowdown", description: "Next thread in project", scope: "chat" },
  { id: "lock", keys: "mod+l", description: "Toggle follow latest output", scope: "chat" },
  { id: "tasks", keys: "mod+j", description: "Toggle tasks panel", scope: "chat" },
  { id: "send", keys: "enter", description: "Send (or queue while busy)", scope: "composer" },
  { id: "newline", keys: "shift+enter", description: "Insert newline", scope: "composer" },
  { id: "sendNow", keys: "mod+enter", description: "Interrupt and send now", scope: "composer" },
  { id: "clearDraft", keys: "escape", description: "Clear draft (or queued prompt)", scope: "composer" },
  { id: "recall", keys: "arrowup", description: "Recall last prompt when empty", scope: "composer" },
];

/**
 * Composer bindings are textarea-specific (Enter, ↑, etc.) and not part of
 * the configurable override surface. Listing them here lets us hide their
 * "remap" controls in Settings.
 */
export const NON_CONFIGURABLE_IDS = new Set<string>([
  "send",
  "newline",
  "sendNow",
  "clearDraft",
  "recall",
]);

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/i.test(navigator.platform || (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || "");

export function formatKeys(spec: string): string {
  if (!spec) return "—";
  return spec
    .split("+")
    .map((part) => {
      const k = part.trim().toLowerCase();
      if (k === "mod") return isMac ? "⌘" : "Ctrl";
      if (k === "cmd" || k === "meta" || k === "command") return "⌘";
      if (k === "ctrl" || k === "control") return "Ctrl";
      if (k === "shift") return "⇧";
      if (k === "alt" || k === "option") return isMac ? "⌥" : "Alt";
      if (k === "arrowup") return "↑";
      if (k === "arrowdown") return "↓";
      if (k === "arrowleft") return "←";
      if (k === "arrowright") return "→";
      if (k === "enter") return "↵";
      if (k === "escape") return "Esc";
      if (k === "tab") return "Tab";
      if (k === "space") return "Space";
      if (k === "comma") return ",";
      if (k === "slash") return "/";
      if (k === "period") return ".";
      if (k.length === 1) return k.toUpperCase();
      return part;
    })
    .join("+");
}

export function isMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

type ParsedKey = {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Either ctrlKey OR metaKey is acceptable (the `mod` token). */
  modEither: boolean;
  key: string;
};

const KEY_ALIASES: Record<string, string> = {
  "↑": "arrowup",
  "↓": "arrowdown",
  "←": "arrowleft",
  "→": "arrowright",
  enter: "enter",
  return: "enter",
  esc: "escape",
  escape: "escape",
  space: " ",
  comma: ",",
  slash: "/",
  period: ".",
  tab: "tab",
};

export function parseKey(spec: string): ParsedKey | null {
  if (!spec || typeof spec !== "string") return null;
  const parts = spec.split("+").map((p) => p.trim().toLowerCase());
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let modEither = false;
  let key = "";
  for (const p of parts) {
    if (p === "⌘" || p === "cmd" || p === "command" || p === "meta") meta = true;
    else if (p === "ctrl" || p === "control") ctrl = true;
    else if (p === "⇧" || p === "shift") shift = true;
    else if (p === "⌥" || p === "alt" || p === "option") alt = true;
    else if (p === "mod") modEither = true;
    else key = p;
  }
  if (!key) return null;
  key = KEY_ALIASES[key] ?? key;
  return { ctrl, meta, alt, shift, modEither, key };
}

export function matchesKey(
  e: KeyboardEvent | React.KeyboardEvent,
  spec: string,
): boolean {
  const parsed = parseKey(spec);
  if (!parsed) return false;
  if (parsed.modEither) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else {
    if (parsed.ctrl !== e.ctrlKey) return false;
    if (parsed.meta !== e.metaKey) return false;
  }
  if (parsed.alt !== e.altKey) return false;
  if (parsed.shift !== e.shiftKey) return false;
  const eKey = e.key.toLowerCase();
  return parsed.key === eKey;
}

/**
 * Resolve the effective key spec for an action ID, preferring the user's
 * override when present and non-empty. Returns empty string if the user has
 * deliberately disabled the binding (e.g. set to ""), letting callers skip
 * the dispatch entirely.
 */
export function effectiveKey(
  id: string,
  defaultSpec: string,
  overrides: Record<string, string>,
): string {
  const o = overrides[id];
  if (typeof o === "string") return o;
  return defaultSpec;
}

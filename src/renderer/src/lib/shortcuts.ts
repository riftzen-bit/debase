export type ShortcutScope = "global" | "chat" | "composer";
export type KeybindingCommand =
  | "settings.toggle"
  | "shortcuts.open"
  | "commandPalette.toggle"
  | "chat.new"
  | "chat.stop"
  | "chat.archive"
  | "editor.openFavorite"
  | "sidebar.toggle"
  | "thread.previous"
  | "thread.next"
  | "lock.toggle"
  | "diff.toggle"
  | "terminal.toggle"
  | "terminal.new"
  | "terminal.split"
  | "terminal.close"
  | "tasks.toggle"
  | "plan.toggle"
  | "modelPicker.toggle";

export type ShortcutBinding = {
  id: string;
  command: KeybindingCommand;
  keys: string;
  when?: string;
  description: string;
  scope: ShortcutScope;
};

export type KeybindingRule = {
  key: string;
  command: KeybindingCommand;
  when?: string;
};

export type KeybindingContext = {
  terminalFocus?: boolean;
  terminalOpen?: boolean;
  modelPickerOpen?: boolean;
};

export const SHORTCUTS: ShortcutBinding[] = [
  { id: "settings", command: "settings.toggle", keys: "mod+,", description: "Toggle settings", scope: "global" },
  { id: "shortcuts", command: "shortcuts.open", keys: "mod+/", description: "Show keyboard shortcuts", scope: "global" },
  { id: "palette", command: "commandPalette.toggle", keys: "mod+k", when: "!terminalFocus", description: "Command palette", scope: "global" },
  { id: "newThread", command: "chat.new", keys: "mod+n", when: "!terminalFocus", description: "New thread in current project", scope: "global" },
  { id: "openEditor", command: "editor.openFavorite", keys: "mod+o", when: "!terminalFocus", description: "Open current project in editor", scope: "global" },
  { id: "sidebar", command: "sidebar.toggle", keys: "mod+b", description: "Toggle sidebar", scope: "global" },
  { id: "stop", command: "chat.stop", keys: "mod+.", description: "Stop running stream", scope: "chat" },
  { id: "archiveThread", command: "chat.archive", keys: "mod+w", when: "!terminalFocus", description: "Archive current thread", scope: "chat" },
  { id: "prevThread", command: "thread.previous", keys: "alt+arrowup", description: "Previous thread in project", scope: "chat" },
  { id: "nextThread", command: "thread.next", keys: "alt+arrowdown", description: "Next thread in project", scope: "chat" },
  { id: "lock", command: "lock.toggle", keys: "mod+l", description: "Toggle follow latest output", scope: "chat" },
  { id: "diff", command: "diff.toggle", keys: "mod+d", when: "!terminalFocus", description: "Toggle git diff panel", scope: "chat" },
  { id: "terminal", command: "terminal.toggle", keys: "mod+j", description: "Toggle terminal", scope: "chat" },
  { id: "terminalNew", command: "terminal.new", keys: "mod+n", when: "terminalFocus", description: "New terminal when terminal is focused", scope: "chat" },
  { id: "terminalSplit", command: "terminal.split", keys: "mod+d", when: "terminalFocus", description: "Split terminal when terminal is focused", scope: "chat" },
  { id: "terminalClose", command: "terminal.close", keys: "mod+w", when: "terminalFocus", description: "Close terminal when terminal is focused", scope: "chat" },
  { id: "tasks", command: "tasks.toggle", keys: "mod+shift+j", description: "Toggle tasks panel", scope: "chat" },
  { id: "planSidebar", command: "plan.toggle", keys: "mod+shift+l", description: "Toggle plan panel", scope: "chat" },
  { id: "modelPicker", command: "modelPicker.toggle", keys: "mod+shift+m", when: "!terminalFocus", description: "Toggle model picker", scope: "chat" },
  { id: "send", command: "commandPalette.toggle", keys: "enter", description: "Send (or queue while busy)", scope: "composer" },
  { id: "newline", command: "commandPalette.toggle", keys: "shift+enter", description: "Insert newline", scope: "composer" },
  { id: "sendNow", command: "commandPalette.toggle", keys: "mod+enter", description: "Interrupt and send now", scope: "composer" },
  { id: "clearDraft", command: "commandPalette.toggle", keys: "escape", description: "Clear draft (or queued prompt)", scope: "composer" },
  { id: "recall", command: "commandPalette.toggle", keys: "arrowup", description: "Recall last prompt when empty", scope: "composer" },
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

export const DEFAULT_KEYBINDING_RULES: KeybindingRule[] = SHORTCUTS
  .filter((shortcut) => !NON_CONFIGURABLE_IDS.has(shortcut.id))
  .map((shortcut) => ({
    key: shortcut.keys,
    command: shortcut.command,
    ...(shortcut.when ? { when: shortcut.when } : {}),
  }));

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

export function keybindingCommandForEvent(
  e: KeyboardEvent | React.KeyboardEvent,
  rules: readonly KeybindingRule[],
  context: KeybindingContext,
): KeybindingCommand | null {
  let matched: KeybindingCommand | null = null;
  for (const rule of rules) {
    if (!matchesKey(e, rule.key)) continue;
    if (rule.when && !evaluateWhen(rule.when, context)) continue;
    matched = rule.command;
  }
  return matched;
}

export function matchesCommand(
  e: KeyboardEvent | React.KeyboardEvent,
  command: KeybindingCommand,
  rules: readonly KeybindingRule[],
  context: KeybindingContext = {},
): boolean {
  return keybindingCommandForEvent(e, rules, context) === command;
}

export function ruleForShortcutId(id: string, key: string): KeybindingRule | null {
  const shortcut = SHORTCUTS.find((item) => item.id === id);
  if (!shortcut || NON_CONFIGURABLE_IDS.has(shortcut.id)) return null;
  return {
    key,
    command: shortcut.command,
    ...(shortcut.when ? { when: shortcut.when } : {}),
  };
}

export function isKeybindingCommand(value: unknown): value is KeybindingCommand {
  return (
    typeof value === "string" &&
    SHORTCUTS.some((shortcut) => shortcut.command === value)
  );
}

export function sanitizeKeybindingRules(raw: unknown): KeybindingRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: KeybindingRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rule = item as { key?: unknown; command?: unknown; when?: unknown };
    if (typeof rule.key !== "string" || rule.key.trim().length === 0) continue;
    if (!isKeybindingCommand(rule.command)) continue;
    const when = typeof rule.when === "string" && rule.when.trim().length > 0
      ? rule.when.trim()
      : undefined;
    rules.push({
      key: rule.key.trim(),
      command: rule.command,
      ...(when ? { when } : {}),
    });
  }
  return rules;
}

function evaluateWhen(expression: string, context: KeybindingContext): boolean {
  const tokens = tokenizeWhen(expression);
  if (!tokens || tokens.length === 0) return false;
  let index = 0;

  const parsePrimary = (): boolean | null => {
    const token = tokens[index];
    if (!token) return null;
    if (token === "(") {
      index += 1;
      const value = parseOr();
      if (tokens[index] !== ")") return null;
      index += 1;
      return value;
    }
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token)) {
      index += 1;
      return Boolean(context[token as keyof KeybindingContext]);
    }
    return null;
  };

  const parseUnary = (): boolean | null => {
    if (tokens[index] === "!") {
      index += 1;
      const value = parseUnary();
      return value == null ? null : !value;
    }
    return parsePrimary();
  };

  const parseAnd = (): boolean | null => {
    let left = parseUnary();
    if (left == null) return null;
    while (tokens[index] === "&&") {
      index += 1;
      const right = parseUnary();
      if (right == null) return null;
      left = left && right;
    }
    return left;
  };

  const parseOr = (): boolean | null => {
    let left = parseAnd();
    if (left == null) return null;
    while (tokens[index] === "||") {
      index += 1;
      const right = parseAnd();
      if (right == null) return null;
      left = left || right;
    }
    return left;
  };

  const result = parseOr();
  return result === true && index === tokens.length;
}

function tokenizeWhen(expression: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (expression.startsWith("&&", i) || expression.startsWith("||", i)) {
      tokens.push(expression.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (ch === "!" || ch === "(" || ch === ")") {
      tokens.push(ch);
      i += 1;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(i));
    if (!match) return null;
    tokens.push(match[0]);
    i += match[0].length;
  }
  return tokens;
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

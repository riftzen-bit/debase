export type TerminalContextSelection = {
  terminalId: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
};

export type TerminalContextDraft = TerminalContextSelection & {
  id: string;
  threadId: string;
  createdAt: number;
};

export type ParsedTerminalContextEntry = {
  header: string;
  body: string;
};

export type DisplayedUserMessageState = {
  visibleText: string;
  copyText: string;
  contexts: ParsedTerminalContextEntry[];
};

const TRAILING_TERMINAL_CONTEXT_BLOCK_PATTERN =
  /\n*<terminal_context>\n([\s\S]*?)\n<\/terminal_context>\s*$/;

export function normalizeTerminalContextText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function normalizeTerminalContextSelection(
  selection: TerminalContextSelection,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(selection.text);
  const terminalId = selection.terminalId.trim();
  const terminalLabel = selection.terminalLabel.trim();
  if (!terminalId || !terminalLabel || !text) return null;
  const lineStart = Math.max(1, Math.floor(selection.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd));
  return { terminalId, terminalLabel, lineStart, lineEnd, text };
}

export function terminalContextDedupKey(context: TerminalContextSelection): string {
  return `${context.terminalId}\0${context.lineStart}\0${context.lineEnd}\0${normalizeTerminalContextText(context.text)}`;
}

export function formatTerminalContextRange(selection: {
  lineStart: number;
  lineEnd: number;
}): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`;
}

export function formatTerminalContextLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}): string {
  return `${selection.terminalLabel} ${formatTerminalContextRange(selection)}`;
}

function buildTerminalContextBodyLines(selection: TerminalContextSelection): string[] {
  return normalizeTerminalContextText(selection.text)
    .split("\n")
    .map((line, index) => `  ${selection.lineStart + index} | ${line}`);
}

export function buildTerminalContextBlock(
  contexts: ReadonlyArray<TerminalContextSelection>,
): string {
  const normalized = contexts
    .map((context) => normalizeTerminalContextSelection(context))
    .filter((context): context is TerminalContextSelection => context !== null);
  if (normalized.length === 0) return "";

  const lines: string[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const context = normalized[index]!;
    lines.push(`- ${formatTerminalContextLabel(context)}:`);
    lines.push(...buildTerminalContextBodyLines(context));
    if (index < normalized.length - 1) lines.push("");
  }
  return ["<terminal_context>", ...lines, "</terminal_context>"].join("\n");
}

export function appendTerminalContextsToPrompt(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextSelection>,
): string {
  const trimmedPrompt = prompt.trim();
  const contextBlock = buildTerminalContextBlock(contexts);
  if (!contextBlock) return trimmedPrompt;
  return trimmedPrompt ? `${trimmedPrompt}\n\n${contextBlock}` : contextBlock;
}

export function deriveDisplayedUserMessageState(prompt: string): DisplayedUserMessageState {
  const match = TRAILING_TERMINAL_CONTEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) return { visibleText: prompt, copyText: prompt, contexts: [] };
  const visibleText = prompt.slice(0, match.index).replace(/\n+$/, "");
  return {
    visibleText,
    copyText: prompt,
    contexts: parseTerminalContextEntries(match[1] ?? ""),
  };
}

function parseTerminalContextEntries(block: string): ParsedTerminalContextEntry[] {
  const entries: ParsedTerminalContextEntry[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;

  const commit = () => {
    if (!current) return;
    entries.push({ header: current.header, body: current.bodyLines.join("\n").trimEnd() });
    current = null;
  };

  for (const rawLine of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(rawLine);
    if (headerMatch) {
      commit();
      current = { header: headerMatch[1]!, bodyLines: [] };
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("  ")) {
      current.bodyLines.push(rawLine.slice(2));
      continue;
    }
    if (rawLine.length === 0) current.bodyLines.push("");
  }

  commit();
  return entries;
}

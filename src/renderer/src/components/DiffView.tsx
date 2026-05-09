import { useState, type ReactNode } from "react";

type DiffLine = { kind: "add" | "del" | "context"; text: string };

type Props = {
  filePath: string;
  lines: DiffLine[];
  /**
   * Initial visible-line cap; lines beyond this are folded behind a
   * "show N more lines" affordance. Default 80 — large enough that small
   * edits render in full but huge file writes fold gracefully.
   */
  cap?: number;
};

const DEFAULT_CAP = 80;

/**
 * Editorial diff. Filename header with +/- counts, then a hunk of green/red
 * lines in mono. Designed to read the same way `claude` CLI prints diffs in
 * the terminal — one prefix column, soft tints (warm green / warm red) so it
 * stays inside the project's paper palette instead of jumping to GitHub
 * primary colors.
 */
export function DiffView({ filePath, lines, cap = DEFAULT_CAP }: Props) {
  const [expanded, setExpanded] = useState(false);
  const adds = lines.reduce((n, l) => n + (l.kind === "add" ? 1 : 0), 0);
  const dels = lines.reduce((n, l) => n + (l.kind === "del" ? 1 : 0), 0);

  const collapse = !expanded && lines.length > cap;
  const visible = collapse ? lines.slice(0, cap) : lines;
  const hidden = lines.length - visible.length;

  return (
    <div className="overflow-hidden rounded-md border border-rule/60 bg-canvas">
      <header className="flex items-center justify-between gap-3 border-b border-rule/60 bg-surface/50 px-3 py-1.5">
        <span className="truncate font-mono text-[11.5px] text-ink-2" title={filePath}>
          {filePath}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] tracking-[0.04em]">
          {adds > 0 && <span className="text-add">+{adds}</span>}
          {adds > 0 && dels > 0 && <span className="text-ink-4"> · </span>}
          {dels > 0 && <span className="text-del">−{dels}</span>}
          {adds === 0 && dels === 0 && <span className="text-ink-3">no change</span>}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 font-mono text-[12px] leading-[1.55]">
          <tbody>
            {visible.map((l, i) => (
              <DiffRow key={i} line={l} />
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-2 border-t border-rule/60 bg-surface/40 px-3 py-1.5 font-mono text-[11px] italic text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
        >
          show {hidden} more {hidden === 1 ? "line" : "lines"}
        </button>
      )}
      {expanded && lines.length > cap && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center justify-center gap-2 border-t border-rule/60 bg-surface/40 px-3 py-1.5 font-mono text-[11px] italic text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
        >
          collapse
        </button>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const tint =
    line.kind === "add"
      ? "bg-add-soft/60"
      : line.kind === "del"
        ? "bg-del-soft/60"
        : "bg-transparent";
  const prefixColor =
    line.kind === "add"
      ? "text-add"
      : line.kind === "del"
        ? "text-del"
        : "text-ink-4";
  const textColor =
    line.kind === "add"
      ? "text-ink"
      : line.kind === "del"
        ? "text-ink-2"
        : "text-ink-3";
  const sigil = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  return (
    <tr className={tint}>
      <td
        className={`select-none border-r border-rule/40 px-2 text-center align-top ${prefixColor}`}
        style={{ width: "1.6rem" }}
      >
        {sigil}
      </td>
      <td className={`whitespace-pre px-3 align-top ${textColor}`}>
        {line.text === "" ? " " : line.text}
      </td>
    </tr>
  );
}

/**
 * Build a side-by-removed-then-added line list from an Edit-tool input.
 * Claude Code's Edit doesn't carry surrounding context, so this is a pure
 * "remove old, insert new" hunk — same shape `git diff` would emit if every
 * old line had a matching new line at the same offset.
 */
export function buildEditDiff(oldString: string, newString: string): DiffLine[] {
  const oldLines = splitLines(oldString);
  const newLines = splitLines(newString);
  const out: DiffLine[] = [];
  for (const t of oldLines) out.push({ kind: "del", text: t });
  for (const t of newLines) out.push({ kind: "add", text: t });
  return out;
}

/** Build the diff line list for a Write-tool input — every line is added. */
export function buildWriteDiff(content: string): DiffLine[] {
  return splitLines(content).map<DiffLine>((text) => ({ kind: "add", text }));
}

/** Build a single combined diff from a MultiEdit-style edits[] array. */
export function buildMultiEditDiff(
  edits: { old_string?: unknown; new_string?: unknown }[],
): DiffLine[] {
  const out: DiffLine[] = [];
  edits.forEach((edit, i) => {
    if (i > 0) out.push({ kind: "context", text: "" });
    const o = typeof edit.old_string === "string" ? edit.old_string : "";
    const n = typeof edit.new_string === "string" ? edit.new_string : "";
    for (const t of splitLines(o)) out.push({ kind: "del", text: t });
    for (const t of splitLines(n)) out.push({ kind: "add", text: t });
  });
  return out;
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  return s.split("\n");
}

export function tryRenderDiff(
  toolName: string,
  input: unknown,
): ReactNode | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const filePath = pickString(obj, "file_path", "path");
  const name = toolName.toLowerCase();

  if (name === "edit" && filePath) {
    const oldStr = pickString(obj, "old_string");
    const newStr = pickString(obj, "new_string");
    if (oldStr === undefined && newStr === undefined) return null;
    return (
      <DiffView
        filePath={filePath}
        lines={buildEditDiff(oldStr ?? "", newStr ?? "")}
      />
    );
  }

  if (name === "multiedit" && filePath) {
    const edits = obj.edits;
    if (!Array.isArray(edits)) return null;
    return (
      <DiffView
        filePath={filePath}
        lines={buildMultiEditDiff(edits as { old_string?: unknown; new_string?: unknown }[])}
      />
    );
  }

  if (name === "write" && filePath) {
    const content = pickString(obj, "content");
    if (content === undefined) return null;
    return <DiffView filePath={filePath} lines={buildWriteDiff(content)} />;
  }

  return null;
}

function pickString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

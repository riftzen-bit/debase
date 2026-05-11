import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GitStatusFile, GitStatusResponse } from "@shared/chat";
import type { Project, Thread } from "../state/types";
import { FileIcon } from "../lib/fileIcons";
import { threadCwd } from "../lib/workdir";
import {
  CheckIcon,
  CloseIcon,
  DiffIcon,
  ExternalLinkIcon,
  ResetIcon,
} from "./icons";

type Props = {
  project: Project;
  thread: Thread;
  onClose: () => void;
};

type StatusState =
  | { kind: "loading" }
  | { kind: "ready"; status: Extract<GitStatusResponse, { ok: true; isRepo: true }> }
  | { kind: "not-repo" }
  | { kind: "error"; message: string };

type DiffState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; diff: string }
  | { kind: "error"; message: string };

type DiffLine = {
  kind: "meta" | "hunk" | "add" | "del" | "context";
  text: string;
};

type ParsedFileDiff = {
  key: string;
  path: string;
  oldPath: string | null;
  lines: DiffLine[];
  added: number;
  removed: number;
};

const ALL_FILES = "__all__";
const MAX_DIFF_CHARS = 180_000;

export function DiffPanel({ project, thread, onClose }: Props) {
  const cwd = threadCwd(project, thread);
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [selectedPath, setSelectedPath] = useState<string>(ALL_FILES);
  const [diffState, setDiffState] = useState<DiffState>({ kind: "idle" });
  const [wordWrap, setWordWrap] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);

  const refreshStatus = async () => {
    if (!cwd) {
      setStatusState({ kind: "not-repo" });
      return;
    }
    setStatusState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    const response = await window.api.project.gitStatus({ projectPath: cwd });
    if (!response.ok) {
      setStatusState({ kind: "error", message: response.error });
      return;
    }
    if (!response.isRepo) {
      setStatusState({ kind: "not-repo" });
      return;
    }
    setStatusState({ kind: "ready", status: response });
    setSelectedPath((current) => {
      if (current === ALL_FILES) return current;
      return response.files.some((file) => file.path === current) ? current : ALL_FILES;
    });
  };

  useEffect(() => {
    void refreshStatus();
  }, [cwd, thread.id, thread.updatedAt]);

  useEffect(() => {
    if (!cwd || statusState.kind !== "ready") {
      setDiffState({ kind: "idle" });
      return;
    }
    let alive = true;
    setDiffState({ kind: "loading" });
    const filePath = selectedPath === ALL_FILES ? undefined : selectedPath;
    void window.api.project
      .gitDiff({ projectPath: cwd, filePath, ignoreWhitespace })
      .then((response) => {
        if (!alive) return;
        if (!response.ok) {
          setDiffState({ kind: "error", message: response.error });
          return;
        }
        setDiffState({ kind: "ready", diff: response.diff });
      });
    return () => {
      alive = false;
    };
  }, [cwd, selectedPath, statusState.kind, thread.updatedAt, ignoreWhitespace]);

  const status = statusState.kind === "ready" ? statusState.status : null;
  const dirtyCount = status
    ? status.staged + status.unstaged + status.untracked + status.conflicted
    : 0;
  const selectedFile = status?.files.find((file) => file.path === selectedPath) ?? null;
  const renderable = useMemo(() => {
    if (diffState.kind !== "ready") return [];
    return parseUnifiedDiff(diffState.diff);
  }, [diffState]);
  const clipped =
    diffState.kind === "ready" && diffState.diff.length > MAX_DIFF_CHARS;

  return (
    <aside
      role="region"
      aria-label="Diff"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30 flex h-full min-h-0 w-full min-w-0 max-w-none shrink-0 flex-col border-l border-rule bg-canvas overflow-hidden sm:w-[42vw] sm:min-w-[360px] sm:max-w-[560px]"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-rule px-3">
        <span className="text-ink-3">
          <DiffIcon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[13px] font-medium text-ink">Diff</span>
            {status && (
              <span className="font-mono text-[10.5px] text-ink-3">
                {dirtyCount} changed
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[10.5px] text-ink-3">{cwd}</div>
        </div>
        <button
          type="button"
          onClick={() => setWordWrap((value) => !value)}
          aria-pressed={wordWrap}
          title={wordWrap ? "Disable line wrap" : "Enable line wrap"}
          className={`h-7 rounded-sm border px-2 font-mono text-[10.5px] transition-colors ${
            wordWrap
              ? "border-accent/50 bg-accent-soft/60 text-accent-deep"
              : "border-rule text-ink-3 hover:bg-surface hover:text-ink-2"
          }`}
        >
          wrap
        </button>
        <button
          type="button"
          onClick={() => setIgnoreWhitespace((value) => !value)}
          aria-pressed={ignoreWhitespace}
          title={ignoreWhitespace ? "Show whitespace changes" : "Ignore whitespace changes"}
          className={`h-7 rounded-sm border px-2 font-mono text-[10.5px] transition-colors ${
            ignoreWhitespace
              ? "border-accent/50 bg-accent-soft/60 text-accent-deep"
              : "border-rule text-ink-3 hover:bg-surface hover:text-ink-2"
          }`}
        >
          space
        </button>
        <IconButton label="Refresh diff" onClick={() => void refreshStatus()}>
          <ResetIcon size={12} />
        </IconButton>
        <IconButton label="Close diff panel" onClick={onClose}>
          <CloseIcon size={12} />
        </IconButton>
      </header>

      {statusState.kind === "loading" ? (
        <PanelMessage>loading git status</PanelMessage>
      ) : statusState.kind === "not-repo" ? (
        <PanelMessage>not a git repository</PanelMessage>
      ) : statusState.kind === "error" ? (
        <PanelMessage tone="error">{statusState.message}</PanelMessage>
      ) : (
        <>
          <div className="shrink-0 border-b border-rule/70">
            <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
              <FileChip
                label="All files"
                active={selectedPath === ALL_FILES}
                statusLabel={dirtyCount > 0 ? String(dirtyCount) : "0"}
                onClick={() => setSelectedPath(ALL_FILES)}
              />
              {statusState.status.files.map((file) => (
                <FileChip
                  key={`${file.index}:${file.worktree}:${file.path}`}
                  file={file}
                  active={selectedPath === file.path}
                  label={file.path}
                  statusLabel={statusLabel(file.index, file.worktree)}
                  onClick={() => setSelectedPath(file.path)}
                />
              ))}
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
            <SelectedFileBar cwd={cwd} selectedPath={selectedPath} selectedFile={selectedFile} />
            <DiffBody
              state={diffState}
              files={renderable}
              selectedPath={selectedPath}
              wordWrap={wordWrap}
              clipped={clipped}
            />
          </div>
        </>
      )}
    </aside>
  );
}

function FileChip({
  label,
  statusLabel,
  active,
  onClick,
  file,
}: {
  label: string;
  statusLabel: string;
  active: boolean;
  onClick: () => void;
  file?: GitStatusFile;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-sm border px-2 text-left transition-colors ${
        active
          ? "border-accent/60 bg-accent-soft/60 text-accent-deep"
          : "border-rule bg-surface/40 text-ink-2 hover:border-rule-strong hover:bg-surface"
      }`}
    >
      <span className={`font-mono text-[10px] ${statusTone(file?.index ?? " ", file?.worktree ?? " ")}`}>
        {statusLabel}
      </span>
      {file && (
        <span className="shrink-0 text-ink-3">
          <FileIcon name={file.path} size={12} />
        </span>
      )}
      <span className="min-w-0 truncate font-mono text-[11px]">{label}</span>
    </button>
  );
}

function SelectedFileBar({
  cwd,
  selectedPath,
  selectedFile,
}: {
  cwd: string;
  selectedPath: string;
  selectedFile: GitStatusFile | null;
}) {
  const label = selectedPath === ALL_FILES ? "working tree" : selectedPath;
  const target = selectedPath === ALL_FILES ? cwd : joinPath(cwd, selectedPath);
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-rule/60 px-3 py-2">
      {selectedFile ? (
        <span className={`w-8 shrink-0 font-mono text-[10.5px] ${statusTone(selectedFile.index, selectedFile.worktree)}`}>
          {statusLabel(selectedFile.index, selectedFile.worktree)}
        </span>
      ) : (
        <span className="shrink-0 text-add">
          <CheckIcon size={11} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => void window.api.shell.openPath(target)}
        title={`Reveal ${target}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
      >
        <ExternalLinkIcon size={12} />
      </button>
    </div>
  );
}

function DiffBody({
  state,
  files,
  selectedPath,
  wordWrap,
  clipped,
}: {
  state: DiffState;
  files: ParsedFileDiff[];
  selectedPath: string;
  wordWrap: boolean;
  clipped: boolean;
}) {
  if (state.kind === "idle" || state.kind === "loading") {
    return <PanelMessage>loading diff</PanelMessage>;
  }
  if (state.kind === "error") {
    return <PanelMessage tone="error">{state.message}</PanelMessage>;
  }
  if (state.kind !== "ready") {
    return <PanelMessage>loading diff</PanelMessage>;
  }
  if (state.diff.trim().length === 0) {
    return (
      <PanelMessage>
        {selectedPath === ALL_FILES ? "no working tree diff" : "no text diff for this file"}
      </PanelMessage>
    );
  }

  if (files.length === 0) {
    const text = clipped ? state.diff.slice(0, MAX_DIFF_CHARS) : state.diff;
    return (
      <div className="min-h-0 overflow-auto p-3">
        <pre className={rawDiffClassName(wordWrap)}>{text}</pre>
        {clipped && <ClipNotice />}
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-auto p-2">
      {files.map((file) => (
        <FileDiffCard key={file.key} file={file} wordWrap={wordWrap} />
      ))}
      {clipped && <ClipNotice />}
    </div>
  );
}

function FileDiffCard({ file, wordWrap }: { file: ParsedFileDiff; wordWrap: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="mb-2 overflow-hidden rounded-md border border-rule/70 bg-surface/20 last:mb-0">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 border-b border-rule/60 bg-surface/50 px-3 py-2 text-left"
      >
        <span className="text-ink-3">
          <FileIcon name={file.path} size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2" title={file.path}>
          {file.path}
        </span>
        {file.oldPath && file.oldPath !== file.path && (
          <span className="hidden max-w-[140px] truncate font-mono text-[10.5px] text-ink-3 sm:inline">
            from {file.oldPath}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10.5px] text-add">+{file.added}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-del">-{file.removed}</span>
      </button>
      {!collapsed && (
        <table className="w-full border-separate border-spacing-0 font-mono text-[11.5px] leading-[1.55]">
          <tbody>
            {file.lines.map((line, index) => (
              <DiffRow key={index} line={line} wordWrap={wordWrap} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DiffRow({ line, wordWrap }: { line: DiffLine; wordWrap: boolean }) {
  const style = rowStyle(line.kind);
  const prefix =
    line.kind === "add"
      ? "+"
      : line.kind === "del"
        ? "-"
        : line.kind === "hunk"
          ? "@@"
          : " ";
  return (
    <tr className={style.row}>
      <td className={`select-none border-r border-rule/40 px-2 text-center align-top ${style.prefix}`} style={{ width: "2.2rem" }}>
        {prefix}
      </td>
      <td className={`${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"} px-3 align-top ${style.text}`}>
        {line.text.length === 0 ? " " : line.text}
      </td>
    </tr>
  );
}

function PanelMessage({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "muted" | "error";
}) {
  return (
    <div className={`flex min-h-0 flex-1 items-center justify-center px-5 text-center text-[12.5px] ${
      tone === "error" ? "text-error" : "text-ink-3"
    }`}>
      {children}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
    >
      {children}
    </button>
  );
}

function ClipNotice() {
  return (
    <div className="mt-2 rounded-sm border border-rule bg-surface/40 px-3 py-2 text-[11px] text-ink-3">
      Diff clipped at {MAX_DIFF_CHARS.toLocaleString()} characters.
    </div>
  );
}

function rawDiffClassName(wordWrap: boolean): string {
  return `rounded-md border border-rule bg-surface/30 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2 ${
    wordWrap ? "whitespace-pre-wrap break-words" : "overflow-auto whitespace-pre"
  }`;
}

function rowStyle(kind: DiffLine["kind"]): {
  row: string;
  prefix: string;
  text: string;
} {
  switch (kind) {
    case "add":
      return { row: "bg-add-soft/60", prefix: "text-add", text: "text-ink" };
    case "del":
      return { row: "bg-del-soft/60", prefix: "text-del", text: "text-ink-2" };
    case "hunk":
      return { row: "bg-accent-soft/45", prefix: "text-accent-deep", text: "text-accent-deep" };
    case "meta":
      return { row: "bg-surface/50", prefix: "text-ink-4", text: "text-ink-3" };
    default:
      return { row: "bg-transparent", prefix: "text-ink-4", text: "text-ink-3" };
  }
}

function parseUnifiedDiff(diff: string): ParsedFileDiff[] {
  const source = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) : diff;
  const lines = source.split(/\r?\n/);
  const files: ParsedFileDiff[] = [];
  let current: ParsedFileDiff | null = null;
  let oldPath: string | null = null;
  let newPath: string | null = null;

  const finalize = () => {
    if (!current) return;
    if (current.lines.length > 0 || current.added > 0 || current.removed > 0) {
      files.push(current);
    }
    current = null;
    oldPath = null;
    newPath = null;
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith("diff --git ")) {
      finalize();
      const parsed = parseDiffGitLine(rawLine);
      oldPath = parsed.oldPath;
      newPath = parsed.newPath;
      current = {
        key: `${files.length}:${newPath ?? oldPath ?? rawLine}`,
        path: newPath ?? oldPath ?? "unknown",
        oldPath,
        lines: [{ kind: "meta", text: rawLine }],
        added: 0,
        removed: 0,
      };
      continue;
    }
    if (!current) continue;

    if (rawLine.startsWith("--- ")) {
      oldPath = normalizeDiffPath(rawLine.slice(4));
      current.oldPath = oldPath === "/dev/null" ? null : oldPath;
      current.lines.push({ kind: "meta", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      newPath = normalizeDiffPath(rawLine.slice(4));
      if (newPath !== "/dev/null") current.path = newPath;
      current.lines.push({ kind: "meta", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("@@")) {
      current.lines.push({ kind: "hunk", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("+")) {
      current.added += 1;
      current.lines.push({ kind: "add", text: rawLine.slice(1) });
      continue;
    }
    if (rawLine.startsWith("-")) {
      current.removed += 1;
      current.lines.push({ kind: "del", text: rawLine.slice(1) });
      continue;
    }
    if (rawLine.startsWith(" ")) {
      current.lines.push({ kind: "context", text: rawLine.slice(1) });
      continue;
    }
    if (rawLine.length > 0) {
      current.lines.push({ kind: "meta", text: rawLine });
    }
  }
  finalize();
  return files;
}

function parseDiffGitLine(line: string): { oldPath: string | null; newPath: string | null } {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) return { oldPath: null, newPath: null };
  return { oldPath: match[1] ?? null, newPath: match[2] ?? null };
}

function normalizeDiffPath(path: string): string {
  const cleaned = path.trim();
  if (cleaned === "/dev/null") return cleaned;
  if (cleaned.startsWith("a/") || cleaned.startsWith("b/")) return cleaned.slice(2);
  return cleaned;
}

function statusLabel(index: string, worktree: string): string {
  if (index === "?" && worktree === "?") return "??";
  if (isConflict(index, worktree)) return "!!";
  return `${index === " " ? "-" : index}${worktree === " " ? "-" : worktree}`;
}

function statusTone(index: string, worktree: string): string {
  if (index === "?" && worktree === "?") return "text-ink-3";
  if (isConflict(index, worktree)) return "text-error";
  if (index !== " " && index !== "?") return "text-add";
  return "text-del";
}

function isConflict(index: string, worktree: string): boolean {
  return (
    index === "U" ||
    worktree === "U" ||
    (index === "A" && worktree === "A") ||
    (index === "D" && worktree === "D")
  );
}

function joinPath(root: string, relative: string): string {
  if (!root) return relative;
  const sep = root.includes("\\") || /^[a-zA-Z]:/.test(root) ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${relative.replace(/\//g, sep)}`;
}

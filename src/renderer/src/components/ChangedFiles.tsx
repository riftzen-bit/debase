import { useMemo, useState, type ReactElement } from "react";
import type { AssistantBlock, Thread } from "../state/types";
import { FileIcon } from "../lib/fileIcons";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DiffIcon,
  ExternalLinkIcon,
  FolderIcon,
} from "./icons";
import {
  DiffView,
  buildEditDiff,
  buildMultiEditDiff,
  buildWriteDiff,
} from "./DiffView";

type ToolUseBlock = Extract<AssistantBlock, { kind: "tool_use" }>;
type DiffLineKind = "add" | "del" | "context";
type DiffLine = { kind: DiffLineKind; text: string };

type Edit = { file: string; added: number; removed: number };

type FileNode = {
  kind: "file";
  name: string;
  path: string;
  added: number;
  removed: number;
};

type DirNode = {
  kind: "dir";
  name: string;
  path: string;
  added: number;
  removed: number;
  children: TreeNode[];
};

type TreeNode = FileNode | DirNode;

type Props = {
  thread: Thread;
  cwd?: string;
};

export function ChangedFiles({ thread, cwd }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const summary = useMemo(() => buildSummary(thread, cwd), [thread.messages, cwd]);

  // Re-derive the aggregate diff lines only when selection (or thread) changes.
  // The diff is the concatenation of every Edit/Write/MultiEdit hunk that
  // touched this file, in chronological order — same shape as a `git log -p`
  // output limited to one file across the thread.
  const selectedDiff = useMemo(() => {
    if (!selectedFile) return null;
    const blocks = collectBlocksForFile(thread, selectedFile, cwd);
    if (blocks.length === 0) return null;
    return aggregateDiffLines(blocks);
  }, [selectedFile, thread.messages, cwd]);

  if (summary.files === 0) return null;

  const reveal = (p: string) => {
    void window.api.shell.openPath(p);
  };

  const onFileClick = (relativePath: string) => {
    setSelectedFile((prev) => (prev === relativePath ? null : relativePath));
    if (!expanded) setExpanded(true);
  };

  return (
    <div className="border-b border-rule/60 bg-surface/20">
      <div className="mx-auto max-w-3xl px-6 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="text-ink-3">
            {expanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          </span>
          <span className="text-ink-3">
            <DiffIcon size={12} />
          </span>
          <span className="font-mono text-[11.5px] italic text-ink-3">
            changed files
            <span className="ml-2 not-italic text-ink-2">{summary.files}</span>
          </span>
          <span className="ml-auto flex items-center gap-2 font-mono text-[11px]">
            <span className="text-add">+{summary.added}</span>
            <span className="text-del">−{summary.removed}</span>
          </span>
        </button>
        {expanded && (
          <div className="mt-2 border-t border-rule/60 pt-2">
            <Tree
              node={summary.tree}
              depth={0}
              isRoot
              cwd={cwd}
              collapsed={collapsedDirs}
              selectedFile={selectedFile}
              onToggleDir={(path) =>
                setCollapsedDirs((prev) => ({ ...prev, [path]: !prev[path] }))
              }
              onSelectFile={onFileClick}
              onReveal={reveal}
            />
            {selectedFile && selectedDiff && (
              <div className="mt-3 border-t border-rule/60 pt-3">
                <DiffView filePath={selectedFile} lines={selectedDiff} />
              </div>
            )}
            {selectedFile && !selectedDiff && (
              <div className="mt-3 border-t border-rule/60 pt-3 px-3 py-2 text-[12px] italic text-ink-3">
                No diff to show for this file — the agent may have only renamed
                or read it.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tree({
  node,
  depth,
  isRoot,
  cwd,
  collapsed,
  selectedFile,
  onToggleDir,
  onSelectFile,
  onReveal,
}: {
  node: TreeNode;
  depth: number;
  isRoot?: boolean;
  cwd?: string;
  collapsed: Record<string, boolean>;
  selectedFile: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onReveal: (path: string) => void;
}): ReactElement {
  if (node.kind === "file") {
    const absolute = resolveAbsolute(node.path, cwd);
    const isSelected = selectedFile === node.path;
    return (
      <div
        className={`group flex items-center gap-2 rounded-sm py-0.5 pr-1 transition-colors ${
          isSelected
            ? "bg-accent-soft/60"
            : "hover:bg-surface/50"
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className={`shrink-0 ${isSelected ? "text-accent-deep" : "text-ink-3"}`}
        >
          <FileIcon name={node.name} size={12} />
        </span>
        <button
          type="button"
          onClick={() => onSelectFile(node.path)}
          title={isSelected ? "Hide diff" : "Show diff"}
          className={`min-w-0 flex-1 truncate text-left font-mono text-[12px] transition-colors ${
            isSelected
              ? "font-medium text-accent-deep"
              : "text-ink hover:text-accent-deep"
          }`}
        >
          {node.name}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-add">+{node.added}</span>
        <span className="shrink-0 font-mono text-[11px] text-del">−{node.removed}</span>
        <button
          type="button"
          onClick={(e) => {
            // Stop the row from also toggling diff selection on icon click.
            e.stopPropagation();
            onReveal(absolute);
          }}
          title={`Reveal ${absolute}`}
          aria-label={`Reveal ${node.name}`}
          className="ml-1 shrink-0 rounded-sm p-0.5 text-ink-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink-2 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <ExternalLinkIcon size={11} />
        </button>
      </div>
    );
  }

  const isCollapsed = !isRoot && collapsed[node.path] === true;

  return (
    <div>
      {!isRoot && (
        <button
          type="button"
          onClick={() => onToggleDir(node.path)}
          className="flex w-full items-center gap-2 rounded-sm py-0.5 pr-1 text-left hover:bg-surface/50"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className="text-ink-3">
            {isCollapsed ? <ChevronRightIcon size={10} /> : <ChevronDownIcon size={10} />}
          </span>
          <span className="text-ink-3">
            <FolderIcon size={12} />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
            {node.name}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-add">+{node.added}</span>
          <span className="shrink-0 font-mono text-[11px] text-del">−{node.removed}</span>
        </button>
      )}
      {!isCollapsed && (
        <div>
          {node.children.map((child) => (
            <Tree
              key={child.path}
              node={child}
              depth={isRoot ? depth : depth + 1}
              cwd={cwd}
              collapsed={collapsed}
              selectedFile={selectedFile}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              onReveal={onReveal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildSummary(
  thread: Thread,
  cwd?: string,
): { files: number; added: number; removed: number; tree: TreeNode } {
  const edits: Edit[] = [];
  for (const m of thread.messages) {
    if (m.role !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool_use") continue;
      const e = extractEdits(b);
      edits.push(...e);
    }
  }
  const byFile = new Map<string, { added: number; removed: number }>();
  for (const e of edits) {
    const rel = relativeToCwd(e.file, cwd);
    const prev = byFile.get(rel) ?? { added: 0, removed: 0 };
    byFile.set(rel, { added: prev.added + e.added, removed: prev.removed + e.removed });
  }
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const v of byFile.values()) {
    totalAdded += v.added;
    totalRemoved += v.removed;
  }
  const tree = buildTree(byFile);
  return { files: byFile.size, added: totalAdded, removed: totalRemoved, tree };
}

// Walk every assistant message in chronological order and pull out every
// Edit/Write/MultiEdit tool_use whose `file_path` resolves to the same path
// the user clicked in the tree. The order is the agent's own — we don't
// re-sort, so the diff reads turn-by-turn the way it actually happened.
function collectBlocksForFile(
  thread: Thread,
  relativePath: string,
  cwd?: string,
): ToolUseBlock[] {
  const out: ToolUseBlock[] = [];
  for (const m of thread.messages) {
    if (m.role !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool_use") continue;
      if (b.name !== "Edit" && b.name !== "Write" && b.name !== "MultiEdit") {
        continue;
      }
      const input = b.input as Record<string, unknown> | null;
      if (!input || typeof input.file_path !== "string") continue;
      const rel = relativeToCwd(input.file_path, cwd);
      if (rel === relativePath) out.push(b);
    }
  }
  return out;
}

// Combine every block's diff into one DiffLine list, separating consecutive
// hunks with a blank context row so the visual break between turns is clear
// without reading like a syntax error.
function aggregateDiffLines(blocks: ToolUseBlock[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (const b of blocks) {
    const partial = linesForBlock(b);
    if (partial.length === 0) continue;
    if (out.length > 0) out.push({ kind: "context", text: "" });
    out.push(...partial);
  }
  return out;
}

function linesForBlock(b: ToolUseBlock): DiffLine[] {
  const obj = b.input as Record<string, unknown> | null;
  if (!obj) return [];
  if (b.name === "Edit") {
    const o = typeof obj.old_string === "string" ? obj.old_string : "";
    const n = typeof obj.new_string === "string" ? obj.new_string : "";
    return buildEditDiff(o, n);
  }
  if (b.name === "Write") {
    const c = typeof obj.content === "string" ? obj.content : "";
    return buildWriteDiff(c);
  }
  if (b.name === "MultiEdit") {
    const edits = Array.isArray(obj.edits) ? obj.edits : [];
    return buildMultiEditDiff(
      edits as { old_string?: unknown; new_string?: unknown }[],
    );
  }
  return [];
}

function extractEdits(block: Extract<AssistantBlock, { kind: "tool_use" }>): Edit[] {
  const input = block.input as Record<string, unknown> | null;
  if (!input || typeof input !== "object") return [];
  const file = typeof input.file_path === "string" ? input.file_path : null;
  if (!file) return [];

  if (block.name === "Edit") {
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    return [{ file, added: lineCount(newStr), removed: lineCount(oldStr) }];
  }
  if (block.name === "Write") {
    const content = typeof input.content === "string" ? input.content : "";
    return [{ file, added: lineCount(content), removed: 0 }];
  }
  if (block.name === "MultiEdit") {
    const editsRaw = Array.isArray(input.edits) ? input.edits : [];
    let added = 0;
    let removed = 0;
    for (const e of editsRaw) {
      if (!e || typeof e !== "object") continue;
      const eo = e as Record<string, unknown>;
      const oldStr = typeof eo.old_string === "string" ? eo.old_string : "";
      const newStr = typeof eo.new_string === "string" ? eo.new_string : "";
      added += lineCount(newStr);
      removed += lineCount(oldStr);
    }
    return [{ file, added, removed }];
  }
  return [];
}

function lineCount(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

function relativeToCwd(filePath: string, cwd?: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const f = norm(filePath);
  if (!cwd) return f;
  const c = norm(cwd);
  if (f.toLowerCase().startsWith(c.toLowerCase() + "/")) {
    return f.slice(c.length + 1);
  }
  return f;
}

function resolveAbsolute(rel: string, cwd?: string): string {
  if (!cwd) return rel;
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/")) return rel;
  const sep = /^[a-zA-Z]:/.test(cwd) ? "\\" : "/";
  return cwd.replace(/[\\/]+$/, "") + sep + rel.replace(/\//g, sep);
}

function buildTree(byFile: Map<string, { added: number; removed: number }>): TreeNode {
  const root: DirNode = {
    kind: "dir",
    name: "",
    path: "",
    added: 0,
    removed: 0,
    children: [],
  };
  for (const [filePath, stats] of byFile) {
    const parts = filePath.split("/").filter((p) => p.length > 0);
    let node: DirNode = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const segPath = parts.slice(0, i + 1).join("/");
      let child = node.children.find(
        (c): c is DirNode => c.kind === "dir" && c.name === segment,
      );
      if (!child) {
        child = {
          kind: "dir",
          name: segment,
          path: segPath,
          added: 0,
          removed: 0,
          children: [],
        };
        node.children.push(child);
      }
      child.added += stats.added;
      child.removed += stats.removed;
      node = child;
    }
    const fileName = parts[parts.length - 1] ?? filePath;
    node.children.push({
      kind: "file",
      name: fileName,
      path: filePath,
      added: stats.added,
      removed: stats.removed,
    });
    root.added += stats.added;
    root.removed += stats.removed;
  }
  collapseSingletons(root);
  sortTree(root);
  return root;
}

function collapseSingletons(dir: DirNode): void {
  // If a directory has exactly one child that is also a directory, merge them
  // visually so trees like src/renderer/src don't waste a line per segment.
  while (
    dir.children.length === 1 &&
    dir.children[0].kind === "dir" &&
    dir.path !== ""
  ) {
    const only = dir.children[0] as DirNode;
    dir.name = `${dir.name}/${only.name}`;
    dir.path = only.path;
    dir.children = only.children;
  }
  for (const child of dir.children) {
    if (child.kind === "dir") collapseSingletons(child);
  }
}

function sortTree(dir: DirNode): void {
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of dir.children) {
    if (child.kind === "dir") sortTree(child);
  }
}

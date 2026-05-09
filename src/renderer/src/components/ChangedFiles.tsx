import { useMemo, useState, type ReactElement } from "react";
import type { AssistantBlock, Thread } from "../state/types";
import { FileIcon } from "../lib/fileIcons";
import { ChevronDownIcon, ChevronRightIcon, DiffIcon, FolderIcon } from "./icons";

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

  const summary = useMemo(() => buildSummary(thread, cwd), [thread.messages, cwd]);

  if (summary.files === 0) return null;

  const reveal = (p: string) => {
    void window.api.shell.openPath(p);
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
              onToggleDir={(path) =>
                setCollapsedDirs((prev) => ({ ...prev, [path]: !prev[path] }))
              }
              onReveal={reveal}
            />
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
  onToggleDir,
  onReveal,
}: {
  node: TreeNode;
  depth: number;
  isRoot?: boolean;
  cwd?: string;
  collapsed: Record<string, boolean>;
  onToggleDir: (path: string) => void;
  onReveal: (path: string) => void;
}): ReactElement {
  if (node.kind === "file") {
    const absolute = resolveAbsolute(node.path, cwd);
    return (
      <div
        className="group flex items-center gap-2 rounded-sm py-0.5 pr-1 hover:bg-surface/50"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="shrink-0 text-ink-3">
          <FileIcon name={node.name} size={12} />
        </span>
        <button
          type="button"
          onClick={() => onReveal(absolute)}
          title={`Reveal ${absolute}`}
          className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-ink hover:text-accent-deep"
        >
          {node.name}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-add">+{node.added}</span>
        <span className="shrink-0 font-mono text-[11px] text-del">−{node.removed}</span>
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
              onToggleDir={onToggleDir}
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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useStore } from "../state/store";
import { useShortcutOverrides } from "../state/keybindings";
import { effectiveKey, matchesKey } from "../lib/shortcuts";
import { relativeTime, truncate } from "../lib/format";
import type { Project, Thread } from "../state/types";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ComposeIcon,
  ExternalLinkIcon,
  FolderIcon,
  GearIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RestoreIcon,
  SearchIcon,
  SortIcon,
  TrashIcon,
} from "./icons";

type SortMode = "recent" | "alpha";

type MenuState =
  | { kind: "project"; projectId: string; x: number; y: number }
  | { kind: "thread"; threadId: string; x: number; y: number }
  | null;

type EditState = { kind: "project" | "thread"; id: string; value: string } | null;

type Props = {
  onOpenSettings: () => void;
  settingsActive?: boolean;
};

export function Sidebar({ onOpenSettings, settingsActive }: Props) {
  const {
    state,
    newThread,
    selectThread,
    selectProject,
    deleteThread,
    deleteProject,
    renameProject,
    renameThread,
    setThreadPinned,
    setThreadArchived,
    toggleProjectExpanded,
  } = useStore();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [menu, setMenu] = useState<MenuState>(null);
  const [edit, setEdit] = useState<EditState>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts: focus search + new thread. Capture phase beats
  // textarea/input handlers (e.g. macOS Ctrl+K killing the line otherwise).
  // Both bindings honour `userData/keybindings.json` overrides.
  const overrides = useShortcutOverrides();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesKey(e, effectiveKey("search", "mod+k", overrides))) {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (matchesKey(e, effectiveKey("newThread", "mod+shift+n", overrides))) {
        e.preventDefault();
        e.stopPropagation();
        const id = state.selectedProjectId ?? state.projects[0]?.id ?? null;
        if (id) newThread(id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [newThread, state.projects, state.selectedProjectId, overrides]);

  const visibleProjects = useMemo(
    () => filterAndSort(state.projects, search, sort),
    [state.projects, search, sort],
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="space-y-3 px-4 pt-4 pb-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
            <SearchIcon size={14} />
          </span>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads & projects"
            className="w-full rounded-md border border-rule bg-surface/40 py-1.5 pl-9 pr-12 text-[13px] text-ink placeholder:text-ink-3 focus:border-rule-strong focus:outline-none focus:ring-0"
            spellCheck={false}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-3">
            ⌘K
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pb-1.5">
        <h2 className="text-[11.5px] font-medium italic text-ink-3">
          Projects
        </h2>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Toggle sort order"
            onClick={() => setSort((s) => (s === "recent" ? "alpha" : "recent"))}
          >
            <SortIcon size={13} />
          </IconButton>
          <ProjectAdd />
        </div>
      </div>

      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4 pt-1"
        onClick={() => setMenu(null)}
      >
        {visibleProjects.length === 0 ? (
          <SidebarEmpty hasSearch={search.length > 0} />
        ) : (
          <ul className="space-y-0.5">
            {visibleProjects.map((project) => {
              const projectThreads = filterThreads(project.threads, search, sort);
              const isExpanded = project.expanded;
              const isActive =
                state.selectedProjectId === project.id && !state.selectedThreadId;
              return (
                <li key={project.id}>
                  <ProjectRow
                    project={project}
                    expanded={isExpanded}
                    active={isActive}
                    edit={edit?.kind === "project" && edit.id === project.id ? edit.value : null}
                    onEditChange={(v) => setEdit({ kind: "project", id: project.id, value: v })}
                    onCommitEdit={() => {
                      if (edit?.kind === "project" && edit.id === project.id) {
                        renameProject(project.id, edit.value);
                      }
                      setEdit(null);
                    }}
                    onCancelEdit={() => setEdit(null)}
                    onToggle={() => toggleProjectExpanded(project.id)}
                    onSelect={() => selectProject(project.id)}
                    onCompose={() => newThread(project.id)}
                    onDelete={() => deleteProject(project.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        kind: "project",
                        projectId: project.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  />
                  {isExpanded && projectThreads.length > 0 && (
                    <ul className="mt-0.5 mb-1 space-y-0.5 pl-3">
                      {projectThreads.map((thread) => (
                        <li key={thread.id}>
                          <ThreadRow
                            thread={thread}
                            active={state.selectedThreadId === thread.id}
                            running={state.pendings[thread.id] != null}
                            edit={edit?.kind === "thread" && edit.id === thread.id ? edit.value : null}
                            onEditChange={(v) =>
                              setEdit({ kind: "thread", id: thread.id, value: v })
                            }
                            onCommitEdit={() => {
                              if (edit?.kind === "thread" && edit.id === thread.id) {
                                renameThread(thread.id, edit.value);
                              }
                              setEdit(null);
                            }}
                            onCancelEdit={() => setEdit(null)}
                            onSelect={() => selectThread(thread.id)}
                            onArchive={() => setThreadArchived(thread.id, true)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setMenu({
                                kind: "thread",
                                threadId: thread.id,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu, state.projects, {
            renameProject: (id) => {
              const p = state.projects.find((p) => p.id === id);
              if (p) setEdit({ kind: "project", id, value: p.name });
            },
            renameThread: (id) => {
              const t = findThread(state.projects, id);
              if (t) setEdit({ kind: "thread", id, value: t.title });
            },
            deleteProject,
            deleteThread,
            setThreadPinned,
            setThreadArchived,
            newThread,
            revealProject: async (path) => {
              if (path) await window.api.shell.openPath(path);
            },
          })}
          onClose={() => setMenu(null)}
        />
      )}

      <ArchiveSection
        archived={collectArchivedThreads(state.projects, search)}
        open={archiveOpen}
        onToggle={() => setArchiveOpen((v) => !v)}
        selectedThreadId={state.selectedThreadId}
        onSelect={selectThread}
        onRestore={(id) => setThreadArchived(id, false)}
        onDelete={deleteThread}
      />

      <div className="border-t border-rule px-3 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-pressed={settingsActive}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
            settingsActive
              ? "bg-surface text-ink"
              : "text-ink-2 hover:bg-surface hover:text-ink"
          }`}
        >
          <GearIcon size={13} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function ProjectAdd() {
  const { newProject } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <IconButton
      label="Add project"
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          const result = await window.api.dialog.chooseDirectory();
          if (result.ok) {
            newProject(deriveName(result.path), result.path);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <PlusIcon size={13} />
    </IconButton>
  );
}

function SidebarEmpty({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="px-3 py-12 text-center text-[12.5px] text-ink-3">
      {hasSearch ? "No matches." : "No projects yet."}
    </div>
  );
}

type ProjectRowProps = {
  project: Project;
  expanded: boolean;
  active: boolean;
  edit: string | null;
  onEditChange: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggle: () => void;
  onSelect: () => void;
  onCompose: () => void;
  onDelete: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
};

function ProjectRow(props: ProjectRowProps) {
  const {
    project,
    expanded,
    active,
    edit,
    onEditChange,
    onCommitEdit,
    onCancelEdit,
    onToggle,
    onSelect,
    onCompose,
    onDelete,
    onContextMenu,
  } = props;

  const editing = edit !== null;

  return (
    <div
      onContextMenu={onContextMenu}
      className={`group relative flex items-center gap-1 rounded-md pl-1 pr-1 transition-colors ${
        active ? "bg-surface" : "hover:bg-surface/60"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-7 w-5 items-center justify-center text-ink-3 hover:text-ink-2"
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => onEditChange(project.name)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
      >
        <span className="text-ink-3">
          <FolderIcon size={13} />
        </span>
        {editing ? (
          <input
            autoFocus
            value={edit ?? ""}
            onChange={(e) => onEditChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={onCommitEdit}
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") onCommitEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
            className="min-w-0 flex-1 rounded-sm bg-canvas px-1 text-[13px] text-ink ring-1 ring-rule-strong focus:outline-none"
          />
        ) : (
          <span className="line-clamp-1 flex-1 text-[13px] text-ink">
            {truncate(project.name || "Untitled project", 32)}
          </span>
        )}
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <IconButton label="New thread" onClick={onCompose}>
          <ComposeIcon size={13} />
        </IconButton>
        <IconButton label="Delete project" tone="danger" onClick={onDelete}>
          <TrashIcon size={13} />
        </IconButton>
      </div>
    </div>
  );
}

type ThreadRowProps = {
  thread: Thread;
  active: boolean;
  running: boolean;
  edit: string | null;
  onEditChange: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  onArchive: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
};

function ThreadRow(props: ThreadRowProps) {
  const {
    thread,
    active,
    running,
    edit,
    onEditChange,
    onCommitEdit,
    onCancelEdit,
    onSelect,
    onArchive,
    onContextMenu,
  } = props;

  const editing = edit !== null;

  return (
    <div
      onContextMenu={onContextMenu}
      className={`group relative flex items-center gap-1 rounded-md pl-3 pr-1 transition-colors ${
        active ? "bg-surface" : "hover:bg-surface/60"
      }`}
    >
      {running ? (
        <span className="dot-cycle mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" />
      ) : (
        <span
          className={`mr-1 inline-block h-1 w-1 shrink-0 rounded-full ${
            thread.pinned ? "bg-accent" : "bg-rule-strong"
          }`}
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => onEditChange(thread.title)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 pr-1 text-left"
      >
        {editing ? (
          <input
            autoFocus
            value={edit ?? ""}
            onChange={(e) => onEditChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={onCommitEdit}
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") onCommitEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
            className="min-w-0 rounded-sm bg-canvas px-1 text-[13px] text-ink ring-1 ring-rule-strong focus:outline-none"
          />
        ) : (
          <span className="line-clamp-1 text-[13px] text-ink">
            {truncate(thread.title || "Untitled", 36)}
          </span>
        )}
        <span className={`text-[10.5px] ${running ? "text-accent" : "text-ink-3"}`}>
          {running ? "working…" : relativeTime(thread.updatedAt)}
        </span>
      </button>
      {/* Archive is deliberately hidden while a turn is running — pulling
        a busy thread out from under its own stream would orphan the SDK
        session. Right-click still has rename/pin/delete for power-users. */}
      {!running && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label="Archive thread" onClick={onArchive}>
            <ArchiveIcon size={13} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

type ArchivedRowProps = {
  thread: Thread;
  projectName: string;
  active: boolean;
  onSelect: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

function ArchivedRow({
  thread,
  projectName,
  active,
  onSelect,
  onRestore,
  onDelete,
}: ArchivedRowProps) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-md pl-3 pr-1 transition-colors ${
        active ? "bg-surface" : "hover:bg-surface/60"
      }`}
    >
      <span className="mr-1 inline-block h-1 w-1 shrink-0 rounded-full bg-rule-strong" />
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 pr-1 text-left"
      >
        <span className="line-clamp-1 text-[12.5px] text-ink-2">
          {truncate(thread.title || "Untitled", 32)}
        </span>
        <span className="line-clamp-1 font-mono text-[10px] text-ink-3">
          {projectName} · archived {relativeTime(thread.archivedAt ?? thread.updatedAt)}
        </span>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <IconButton label="Restore thread" onClick={onRestore}>
          <RestoreIcon size={13} />
        </IconButton>
        <IconButton label="Delete forever" tone="danger" onClick={onDelete}>
          <TrashIcon size={13} />
        </IconButton>
      </div>
    </div>
  );
}

function ArchiveSection({
  archived,
  open,
  onToggle,
  selectedThreadId,
  onSelect,
  onRestore,
  onDelete,
}: {
  archived: { project: Project; thread: Thread }[];
  open: boolean;
  onToggle: () => void;
  selectedThreadId: string | null;
  onSelect: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (archived.length === 0) return null;
  return (
    <div className="border-t border-rule">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left transition-colors hover:bg-surface/40"
      >
        <span className="flex items-center gap-2">
          <span className="text-ink-3">
            {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          </span>
          <ArchiveIcon size={12} />
          <span className="text-[11.5px] font-medium italic text-ink-3">
            Archive
          </span>
        </span>
        <span className="font-mono text-[10.5px] text-ink-3">{archived.length}</span>
      </button>
      {open && (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto px-2 pb-2 pt-0.5">
          {archived.map(({ project, thread }) => (
            <li key={thread.id}>
              <ArchivedRow
                thread={thread}
                projectName={project.name}
                active={selectedThreadId === thread.id}
                onSelect={() => onSelect(thread.id)}
                onRestore={() => onRestore(thread.id)}
                onDelete={() => onDelete(thread.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  label,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  label: string;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      className={`flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "danger" ? "hover:text-error" : ""
      }`}
    >
      {children}
    </button>
  );
}

function buildMenuItems(
  menu: NonNullable<MenuState>,
  projects: Project[],
  actions: {
    renameProject: (id: string) => void;
    renameThread: (id: string) => void;
    deleteProject: (id: string) => void;
    deleteThread: (id: string) => void;
    setThreadPinned: (id: string, pinned: boolean) => void;
    setThreadArchived: (id: string, archived: boolean) => void;
    newThread: (projectId: string) => void;
    revealProject: (path: string) => Promise<void>;
  },
): ContextMenuEntry[] {
  if (menu.kind === "project") {
    const project = projects.find((p) => p.id === menu.projectId);
    if (!project) return [];
    return [
      {
        key: "compose",
        label: "New thread",
        icon: <ComposeIcon size={13} />,
        onSelect: () => actions.newThread(project.id),
      },
      {
        key: "rename",
        label: "Rename",
        icon: <PencilIcon size={13} />,
        onSelect: () => actions.renameProject(project.id),
      },
      {
        key: "reveal",
        label: "Open folder",
        icon: <ExternalLinkIcon size={13} />,
        onSelect: () => {
          void actions.revealProject(project.path);
        },
        disabled: !project.path,
      },
      { key: "div1", divider: true },
      {
        key: "delete",
        label: "Delete project",
        icon: <TrashIcon size={13} />,
        tone: "danger",
        onSelect: () => actions.deleteProject(project.id),
      },
    ];
  }

  const thread = findThread(projects, menu.threadId);
  if (!thread) return [];
  const isArchived = Boolean(thread.archivedAt);
  return [
    {
      key: "rename",
      label: "Rename",
      icon: <PencilIcon size={13} />,
      onSelect: () => actions.renameThread(thread.id),
    },
    ...(!isArchived
      ? ([
          {
            key: "pin",
            label: thread.pinned ? "Unpin" : "Pin",
            icon: <PinIcon size={13} />,
            onSelect: () => actions.setThreadPinned(thread.id, !thread.pinned),
          },
        ] as ContextMenuEntry[])
      : []),
    {
      key: "archive",
      label: isArchived ? "Restore from archive" : "Archive",
      icon: isArchived ? <RestoreIcon size={13} /> : <ArchiveIcon size={13} />,
      onSelect: () => actions.setThreadArchived(thread.id, !isArchived),
    },
    { key: "div1", divider: true },
    {
      key: "delete",
      label: "Delete thread",
      icon: <TrashIcon size={13} />,
      tone: "danger",
      onSelect: () => actions.deleteThread(thread.id),
    },
  ];
}

function findThread(projects: Project[], threadId: string): Thread | null {
  for (const p of projects) {
    const t = p.threads.find((t) => t.id === threadId);
    if (t) return t;
  }
  return null;
}

function filterAndSort(projects: Project[], q: string, sort: SortMode): Project[] {
  const query = q.trim().toLowerCase();
  const filtered = !query
    ? projects.slice()
    : projects
        .map((p) => {
          const matchProject = p.name.toLowerCase().includes(query);
          const matchedThreads = p.threads.filter((t) =>
            t.title.toLowerCase().includes(query),
          );
          if (matchProject) return p;
          if (matchedThreads.length > 0) return { ...p, threads: matchedThreads };
          return null;
        })
        .filter((p): p is Project => p !== null);

  if (sort === "alpha") {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return filtered;
}

function filterThreads(threads: Thread[], q: string, sort: SortMode): Thread[] {
  const query = q.trim().toLowerCase();
  // Archived threads live in the dedicated Archive section at the bottom of
  // the sidebar — they should never appear inside their original project's
  // thread list.
  const active = threads.filter((t) => !t.archivedAt);
  const filtered = !query
    ? active.slice()
    : active.filter((t) => t.title.toLowerCase().includes(query));
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "alpha") return a.title.localeCompare(b.title);
    return b.updatedAt - a.updatedAt;
  });
  return filtered;
}

function collectArchivedThreads(
  projects: Project[],
  q: string,
): { project: Project; thread: Thread }[] {
  const query = q.trim().toLowerCase();
  const out: { project: Project; thread: Thread }[] = [];
  for (const p of projects) {
    for (const t of p.threads) {
      if (!t.archivedAt) continue;
      if (query && !t.title.toLowerCase().includes(query)) continue;
      out.push({ project: p, thread: t });
    }
  }
  out.sort((a, b) => (b.thread.archivedAt ?? 0) - (a.thread.archivedAt ?? 0));
  return out;
}

function deriveName(path: string): string {
  if (!path) return "Untitled";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "Untitled";
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import {
  ArchiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ComposeIcon,
  DiffIcon,
  EyeIcon,
  FolderPlusIcon,
  GearIcon,
  SearchIcon,
  StopIcon,
} from "./components/icons";
import { Sidebar } from "./components/Sidebar";
import { Settings, type SettingsCategory } from "./components/Settings";
import { isTerminalEventTarget } from "./components/TerminalDrawer";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { CloneProjectDialog } from "./components/CloneProjectDialog";
import { StoreProvider, useStore } from "./state/store";
import { KeybindingsProvider, useCommandForEvent } from "./state/keybindings";
import { matchesKey } from "./lib/shortcuts";
import { threadCwd } from "./lib/workdir";
import type { ReadScriptsResponse } from "@shared/chat";

export function App() {
  return (
    <StoreProvider>
      <KeybindingsProvider>
        <Shell />
      </KeybindingsProvider>
    </StoreProvider>
  );
}

type View = "chat" | "settings";

type ScriptPaletteState =
  | { kind: "idle" | "loading" }
  | {
      kind: "loaded";
      manager: "bun" | "npm" | "pnpm" | "yarn";
      scripts: { name: string; command: string }[];
    }
  | { kind: "error"; message: string };

const SIDEBAR_WIDTH_KEY = "debase.sidebar.width";
const SIDEBAR_HIDDEN_KEY = "debase.sidebar.hidden";
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 280;

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  } catch {
    /* ignore */
  }
  return fallback;
}

function clampSidebar(n: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
}

function Shell() {
  const {
    state,
    cancelPrompt,
    setThreadArchived,
    selectProject,
    selectThread,
    newThread,
    newProject,
    sendPrompt,
    enqueuePrompt,
  } = useStore();
  const commandForEvent = useCommandForEvent();

  const [view, setView] = useState<View>("chat");
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [scriptState, setScriptState] = useState<ScriptPaletteState>({ kind: "idle" });

  const openSettings = useCallback((category?: SettingsCategory) => {
    if (category) setSettingsCategory(category);
    setView("settings");
  }, []);
  const closeSettings = useCallback(() => setView("chat"), []);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    clampSidebar(readNumber(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT)),
  );
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [narrowViewport, setNarrowViewport] = useState(() => window.innerWidth < 720);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarHidden]);
  useEffect(() => {
    const sync = () => setNarrowViewport(window.innerWidth < 720);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const selectedThreadId = state.selectedThreadId;
  const selectedProjectId = state.selectedProjectId;
  const projects = state.projects;
  const pendings = state.pendings;
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    for (const project of projects) {
      const thread = project.threads.find((t) => t.id === selectedThreadId);
      if (thread) return thread;
    }
    return null;
  }, [projects, selectedThreadId]);
  const selectedThreadProject = useMemo(() => {
    if (!selectedThreadId) return null;
    return projects.find((p) => p.threads.some((t) => t.id === selectedThreadId)) ?? null;
  }, [projects, selectedThreadId]);
  const activeProject = selectedThreadProject ?? selectedProject;
  const activeCwd =
    activeProject && selectedThread
      ? threadCwd(activeProject, selectedThread)
      : (selectedProject?.path ?? "");

  const switchThread = useCallback(
    (delta: number) => {
      const project = projects.find((p) => p.id === selectedProjectId);
      if (!project) return;
      const active = project.threads.filter((t) => !t.archivedAt);
      if (active.length === 0) return;
      const idx = selectedThreadId
        ? active.findIndex((t) => t.id === selectedThreadId)
        : -1;
      const nextIdx = idx === -1 ? 0 : (idx + delta + active.length) % active.length;
      selectThread(active[nextIdx].id);
    },
    [projects, selectedProjectId, selectedThreadId, selectThread],
  );

  // Global shortcuts. Capture phase so they beat textarea/input handlers.
  // Each binding consults `effectiveKey` so user overrides from
  // `userData/keybindings.json` take precedence over the default specs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const terminalFocus = isTerminalEventTarget(e.target);
      const command = commandForEvent(e, { terminalFocus });
      if (command === "commandPalette.toggle") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((v) => !v);
        return;
      }
      // Hardcoded legacy alias: Ctrl/Cmd+Shift+P also opens the palette so VS
      // Code muscle memory keeps working even after the primary key was moved
      // to Ctrl/Cmd+K. Not configurable — anyone wanting to reassign should
      // override the `palette` binding above.
      if (matchesKey(e, "mod+shift+p")) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((v) => !v);
        return;
      }
      if (command === "settings.toggle") {
        e.preventDefault();
        e.stopPropagation();
        setView((v) => (v === "settings" ? "chat" : "settings"));
        return;
      }
      if (command === "shortcuts.open") {
        e.preventDefault();
        e.stopPropagation();
        setSettingsCategory("shortcuts");
        setView("settings");
        return;
      }
      if (command === "sidebar.toggle") {
        e.preventDefault();
        e.stopPropagation();
        setSidebarHidden((v) => !v);
        return;
      }
      if (command === "chat.new") {
        if (terminalFocus) return;
        const id = selectedProjectId ?? projects[0]?.id ?? null;
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          newThread(id);
        }
        return;
      }
      if (command === "editor.openFavorite") {
        if (terminalFocus || isEditableTarget(e.target)) return;
        if (activeCwd) {
          e.preventDefault();
          e.stopPropagation();
          void window.api.shell.openInEditor({
            path: activeCwd,
            editorCommand: state.settings.editorCommand ?? "",
          });
        }
        return;
      }
      if (command === "modelPicker.toggle") {
        if (terminalFocus) return;
        if (selectedThreadId) {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent("debase:toggle-model-picker"));
        }
        return;
      }
      if (command === "chat.stop") {
        if (selectedThreadId && pendings[selectedThreadId]) {
          e.preventDefault();
          e.stopPropagation();
          void cancelPrompt(selectedThreadId);
        }
        return;
      }
      if (command === "chat.archive") {
        if (terminalFocus) return;
        if (selectedThreadId) {
          e.preventDefault();
          e.stopPropagation();
          setThreadArchived(selectedThreadId, true);
        }
        return;
      }
      if (command === "thread.previous" || command === "thread.next") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        switchThread(command === "thread.previous" ? -1 : 1);
        return;
      }
      if (e.key === "Escape") {
        if (paletteOpen) {
          e.preventDefault();
          e.stopPropagation();
          setPaletteOpen(false);
          return;
        }
        setView((v) => {
          if (v !== "settings") return v;
          e.preventDefault();
          e.stopPropagation();
          return "chat";
        });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    selectedThreadId,
    selectedProjectId,
    projects,
    pendings,
    cancelPrompt,
    setThreadArchived,
    newThread,
    switchThread,
    paletteOpen,
    commandForEvent,
    activeCwd,
    state.settings.editorCommand,
  ]);

  useEffect(() => {
    if (!activeCwd || !paletteOpen) {
      setScriptState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setScriptState({ kind: "loading" });
    void window.api.project
      .readScripts({ projectPath: activeCwd })
      .then((res: ReadScriptsResponse) => {
        if (cancelled) return;
        if (res.ok) {
          setScriptState({
            kind: "loaded",
            manager: res.manager,
            scripts: res.scripts,
          });
        } else {
          setScriptState({ kind: "error", message: res.error });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeCwd, paletteOpen]);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const projectId = selectedProjectId ?? projects[0]?.id ?? null;
    const hasPending = selectedThreadId ? pendings[selectedThreadId] != null : false;
    const navigationActions: PaletteAction[] = [];
    for (const project of projects) {
      navigationActions.push({
        id: `project:${project.id}`,
        label: `Open project: ${project.name}`,
        hint: project.path || "No path",
        icon: <FolderPlusIcon size={13} />,
        onSelect: () => {
          selectProject(project.id);
          setView("chat");
        },
      });
      for (const thread of project.threads.filter((t) => !t.archivedAt)) {
        navigationActions.push({
          id: `thread:${thread.id}`,
          label: `Open thread: ${thread.title}`,
          hint: project.name,
          icon: <ComposeIcon size={13} />,
          onSelect: () => {
            selectThread(thread.id);
            setView("chat");
          },
        });
      }
    }

    const scriptActions: PaletteAction[] =
      scriptState.kind === "loaded" && selectedThread
        ? scriptState.scripts.map((script) => ({
            id: `script:${script.name}`,
            label: `Run script: ${scriptState.manager} run ${script.name}`,
            hint: script.command,
            icon: <StopIcon size={13} />,
            onSelect: () => {
              const cmd = `${scriptState.manager} run ${script.name}`;
              const text = `Run \`${cmd}\` and share what happened.`;
              if (pendings[selectedThread.id]) enqueuePrompt(text, selectedThread.id);
              else void sendPrompt(text, selectedThread.id);
            },
          }))
        : [];

    return [
      {
        id: "newThread",
        label: "New thread",
        hint: "In current project",
        keys: "mod+n",
        icon: <ComposeIcon size={13} />,
        disabled: !projectId,
        onSelect: () => {
          if (projectId) newThread(projectId);
        },
      },
      {
        id: "newProject",
        label: "Add project…",
        hint: "Pick a folder to anchor a new project",
        icon: <FolderPlusIcon size={13} />,
        onSelect: async () => {
          const result = await window.api.dialog.chooseDirectory();
          if (result.ok) newProject(deriveName(result.path), result.path);
        },
      },
      {
        id: "cloneProject",
        label: "Clone Git repository…",
        hint: "Paste a Git URL, choose a destination, then add the checkout",
        icon: <FolderPlusIcon size={13} />,
        onSelect: () => {
          setCloneDialogOpen(true);
        },
      },
      {
        id: "openCwd",
        label: "Open current working directory",
        hint: activeCwd || "No working directory selected",
        icon: <FolderPlusIcon size={13} />,
        disabled: !activeCwd,
        onSelect: () => {
          if (activeCwd) void window.api.shell.openPath(activeCwd);
        },
      },
      {
        id: "openEditor",
        label: "Open current project in editor",
        hint: activeCwd || "Configure an editor command in Settings",
        keys: "mod+o",
        icon: <GearIcon size={13} />,
        disabled: !activeCwd,
        onSelect: () => {
          if (!activeCwd) return;
          void window.api.shell.openInEditor({
            path: activeCwd,
            editorCommand: state.settings.editorCommand ?? "",
          });
        },
      },
      {
        id: "stop",
        label: "Stop running stream",
        hint: hasPending ? "Cancel the active turn" : "Nothing is running",
        keys: "mod+.",
        icon: <StopIcon size={13} />,
        disabled: !hasPending,
        onSelect: () => {
          if (selectedThreadId) void cancelPrompt(selectedThreadId);
        },
      },
      {
        id: "archiveThread",
        label: "Archive current thread",
        keys: "mod+w",
        icon: <ArchiveIcon size={13} />,
        disabled: !selectedThreadId,
        onSelect: () => {
          if (selectedThreadId) setThreadArchived(selectedThreadId, true);
        },
      },
      {
        id: "search",
        label: "Focus thread search",
        icon: <SearchIcon size={13} />,
        onSelect: () => {
          setSidebarHidden(false);
          window.setTimeout(() => {
            const el = document.querySelector<HTMLInputElement>(
              'aside input[placeholder^="Search"]',
            );
            el?.focus();
            el?.select();
          }, 0);
        },
      },
      {
        id: "sidebar",
        label: "Toggle sidebar",
        keys: "mod+b",
        onSelect: () => setSidebarHidden((v) => !v),
      },
      {
        id: "diff",
        label: "Toggle diff panel",
        hint: activeCwd || "No working directory selected",
        keys: "mod+d",
        icon: <DiffIcon size={13} />,
        disabled: !activeCwd,
        onSelect: () => {
          window.dispatchEvent(new CustomEvent("debase:toggle-diff"));
        },
      },
      {
        id: "planSidebar",
        label: "Toggle plan panel",
        hint: selectedThread ? "Latest plan-mode response" : "No thread selected",
        keys: "mod+shift+l",
        icon: <EyeIcon size={13} />,
        disabled: !selectedThread,
        onSelect: () => {
          window.dispatchEvent(new CustomEvent("debase:toggle-plan"));
        },
      },
      {
        id: "modelPicker",
        label: "Toggle model picker",
        hint: selectedThread ? "Current thread" : "No thread selected",
        keys: "mod+shift+m",
        disabled: !selectedThread,
        onSelect: () => {
          window.dispatchEvent(new CustomEvent("debase:toggle-model-picker"));
        },
      },
      {
        id: "settings",
        label: "Open settings",
        keys: "mod+,",
        icon: <GearIcon size={13} />,
        onSelect: () => openSettings("general"),
      },
      {
        id: "settings.providers",
        label: "Open provider settings",
        hint: "Models, runtime paths, and local CLI status",
        icon: <GearIcon size={13} />,
        onSelect: () => openSettings("providers"),
      },
      {
        id: "settings.source-control",
        label: "Open source control settings",
        hint: "Git remotes and provider auth",
        icon: <DiffIcon size={13} />,
        onSelect: () => openSettings("source-control"),
      },
      {
        id: "shortcuts",
        label: "Show keyboard shortcuts",
        keys: "mod+/",
        icon: <SearchIcon size={13} />,
        onSelect: () => openSettings("shortcuts"),
      },
      {
        id: "settings.archived",
        label: "Open archived threads",
        hint: "Restore or delete archived conversations",
        icon: <ArchiveIcon size={13} />,
        onSelect: () => openSettings("archived"),
      },
      {
        id: "settings.diagnostics",
        label: "Open diagnostics",
        hint: "Provider catalog, skills, source control, and keybindings",
        icon: <SearchIcon size={13} />,
        onSelect: () => openSettings("diagnostics"),
      },
      ...scriptActions,
      ...navigationActions,
    ];
  }, [
    selectedProjectId,
    projects,
    selectedThreadId,
    pendings,
    activeCwd,
    selectedThread,
    scriptState,
    state.settings.editorCommand,
    selectProject,
    selectThread,
    newThread,
    newProject,
    sendPrompt,
    enqueuePrompt,
    cancelPrompt,
    setThreadArchived,
    openSettings,
  ]);

  const effectiveSidebarHidden = sidebarHidden || narrowViewport;
  const gridStyle = effectiveSidebarHidden
    ? { gridTemplateColumns: "0px 1fr" }
    : { gridTemplateColumns: `${sidebarWidth}px 1fr` };

  return (
    <div className="grid h-full grid-rows-[36px_1fr] bg-canvas font-sans text-ink overflow-hidden">
      <TitleBar
        onOpenSettings={() => openSettings()}
        settingsActive={view === "settings"}
        onToggleSidebar={() => setSidebarHidden((v) => !v)}
        sidebarHidden={effectiveSidebarHidden}
      />
      <div className="grid min-h-0 overflow-hidden" style={gridStyle}>
        <div className="relative overflow-hidden border-r border-rule">
          {!effectiveSidebarHidden && (
            <Sidebar onOpenSettings={() => openSettings()} settingsActive={view === "settings"} />
          )}
          {!effectiveSidebarHidden && (
            <SidebarResizeHandle
              width={sidebarWidth}
              onChange={(w) => setSidebarWidth(clampSidebar(w))}
            />
          )}
        </div>
        <div className="relative overflow-hidden">
          {effectiveSidebarHidden && (
            <button
              type="button"
              onClick={() => setSidebarHidden(false)}
              title="Show sidebar (⌘B)"
              aria-label="Show sidebar"
              className="absolute left-2 top-2 z-20 inline-flex h-7 items-center gap-1 rounded-md border border-rule bg-canvas/90 px-1.5 text-ink-3 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
            >
              <ChevronRightIcon size={12} />
            </button>
          )}
          {view === "settings" ? (
            <Settings
              onClose={closeSettings}
              category={settingsCategory}
              onCategoryChange={setSettingsCategory}
            />
          ) : (
            <ChatPanel
              onOpenSettings={() => openSettings()}
              onOpenCloneProject={() => setCloneDialogOpen(true)}
            />
          )}
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      <CloneProjectDialog
        open={cloneDialogOpen}
        onClose={() => setCloneDialogOpen(false)}
        onCloned={newProject}
      />
    </div>
  );
}

function deriveName(path: string): string {
  if (!path) return "Untitled";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "Untitled";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function SidebarResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange: (next: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      startRef.current = { x: e.clientX, w: width };
      setDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      onChange(start.w + (e.clientX - start.x));
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onChange]);

  // Visual reference to icon so eslint doesn't complain — used implicitly via
  // the cursor + accent flash on grab.
  void ChevronLeftIcon;

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => onChange(SIDEBAR_DEFAULT)}
      title="Drag to resize · double-click to reset"
      className={`group absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors ${
        dragging ? "bg-accent/50" : "hover:bg-rule-strong/60"
      }`}
    />
  );
}

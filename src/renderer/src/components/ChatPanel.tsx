import { useEffect, useState } from "react";
import { useActiveThread, useActiveProject, useStore } from "../state/store";
import { useShortcutOverrides } from "../state/keybindings";
import { effectiveKey, matchesKey } from "../lib/shortcuts";
import { ChangedFiles } from "./ChangedFiles";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { PlanFollowUp } from "./PlanFollowUp";
import { TasksPanel } from "./TasksPanel";
import { Welcome } from "./Welcome";

type Props = {
  onOpenSettings: () => void;
};

const LOCK_KEY = "debase.chat.lock";
const TASKS_KEY = "debase.chat.tasks";

export function ChatPanel({ onOpenSettings }: Props) {
  const { state } = useStore();
  const active = useActiveThread();
  const activeProject = useActiveProject();

  // The "follow latest output" lock is owned at the panel level so the
  // MessageList (which scrolls) and the Composer (which renders the toggle)
  // stay in sync without prop-drilling through Markdown / Trace etc.
  const [locked, setLocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCK_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LOCK_KEY, locked ? "1" : "0");
    } catch {
      // ignore — quota / disabled storage
    }
  }, [locked]);
  const toggleLock = () => setLocked((v) => !v);

  const [tasksOpen, setTasksOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TASKS_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, tasksOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [tasksOpen]);
  const toggleTasks = () => setTasksOpen((v) => !v);

  const overrides = useShortcutOverrides();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesKey(e, effectiveKey("lock", "mod+l", overrides))) {
        e.preventDefault();
        e.stopPropagation();
        setLocked((v) => !v);
        return;
      }
      if (matchesKey(e, effectiveKey("tasks", "mod+j", overrides))) {
        e.preventDefault();
        e.stopPropagation();
        setTasksOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [overrides]);

  const hasProjects = state.projects.length > 0;

  if (!hasProjects) {
    return <Welcome onOpenSettings={onOpenSettings} />;
  }

  const composerProps = {
    locked,
    onToggleLock: toggleLock,
    tasksOpen,
    onToggleTasks: toggleTasks,
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <main className="flex flex-1 min-h-0 flex-col bg-canvas overflow-hidden">
        {active ? (
          <>
            <ChatHeader thread={active.thread} project={active.project} />
            <ChangedFiles thread={active.thread} cwd={active.project.path} />
            {active.thread.messages.length === 0 ? (
              <FreshThreadHint />
            ) : (
              <MessageList thread={active.thread} locked={locked} cwd={active.project.path} />
            )}
            <PlanFollowUp thread={active.thread} />
            <Composer {...composerProps} />
          </>
        ) : activeProject ? (
          <>
            <div className="flex-1 overflow-y-auto">
              <EmptyState project={activeProject} />
            </div>
            <Composer {...composerProps} />
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <NoSelection />
            </div>
            <Composer {...composerProps} />
          </>
        )}
      </main>
      {tasksOpen && (
        <div className="w-[360px] shrink-0 min-h-0 overflow-hidden">
          <TasksPanel
            thread={active?.thread ?? null}
            onClose={() => setTasksOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function FreshThreadHint() {
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <p className="max-w-sm text-center text-[14px] text-ink-3">
        Type a prompt below to begin. Tool calls and replies stream in as the agent works.
      </p>
    </div>
  );
}

function NoSelection() {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <p className="max-w-sm text-center text-[13.5px] text-ink-3">
        Select a project or thread on the left, or start a new one.
      </p>
    </div>
  );
}

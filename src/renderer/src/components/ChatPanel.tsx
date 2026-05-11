import { useEffect, useRef, useState } from "react";
import { useActiveThread, useActiveProject, useStore } from "../state/store";
import { useCommandForEvent } from "../state/keybindings";
import { ChangedFiles } from "./ChangedFiles";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { DiffPanel } from "./DiffPanel";
import { EmptyState } from "./EmptyState";
import { GitStatusBar } from "./GitStatusBar";
import { MessageList } from "./MessageList";
import { PlanFollowUp } from "./PlanFollowUp";
import { PlanSidebar } from "./PlanSidebar";
import { TasksPanel } from "./TasksPanel";
import { TerminalDrawer, isTerminalEventTarget } from "./TerminalDrawer";
import { Welcome } from "./Welcome";
import { threadCwd } from "../lib/workdir";
import { latestProposedPlan } from "../lib/proposedPlan";
import { newId } from "../lib/id";
import {
  normalizeTerminalContextSelection,
  terminalContextDedupKey,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";

type Props = {
  onOpenSettings: () => void;
  onOpenCloneProject: () => void;
};

const LOCK_KEY = "debase.chat.lock";
const TASKS_KEY = "debase.chat.tasks";
const TERMINAL_KEY = "debase.chat.terminal";
const DIFF_KEY = "debase.chat.diff";
const PLAN_KEY = "debase.chat.plan";

export function ChatPanel({ onOpenSettings, onOpenCloneProject }: Props) {
  const { state } = useStore();
  const active = useActiveThread();
  const activeProject = useActiveProject();
  const lastAutoOpenedPlanId = useRef<string | null>(null);
  const [terminalContextsByThread, setTerminalContextsByThread] = useState<
    Record<string, TerminalContextDraft[]>
  >({});

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

  const [diffOpen, setDiffOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DIFF_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(DIFF_KEY, diffOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [diffOpen]);
  const toggleDiff = () => setDiffOpen((v) => !v);
  useEffect(() => {
    const onToggleDiff = () => setDiffOpen((v) => !v);
    window.addEventListener("debase:toggle-diff", onToggleDiff);
    return () => window.removeEventListener("debase:toggle-diff", onToggleDiff);
  }, []);

  const [planOpen, setPlanOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PLAN_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PLAN_KEY, planOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [planOpen]);
  const togglePlan = () => setPlanOpen((v) => !v);
  useEffect(() => {
    const onTogglePlan = () => setPlanOpen((v) => !v);
    window.addEventListener("debase:toggle-plan", onTogglePlan);
    return () => window.removeEventListener("debase:toggle-plan", onTogglePlan);
  }, []);

  const [terminalOpen, setTerminalOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TERMINAL_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_KEY, terminalOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [terminalOpen]);
  const toggleTerminal = () => setTerminalOpen((v) => !v);

  const commandForEvent = useCommandForEvent();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const terminalFocus = isTerminalEventTarget(e.target);
      const command = commandForEvent(e, { terminalFocus, terminalOpen });
      if (command === "lock.toggle") {
        e.preventDefault();
        e.stopPropagation();
        setLocked((v) => !v);
        return;
      }
      if (command === "terminal.toggle") {
        e.preventDefault();
        e.stopPropagation();
        setTerminalOpen((v) => !v);
        return;
      }
      if (command === "diff.toggle") {
        if (terminalFocus) return;
        e.preventDefault();
        e.stopPropagation();
        setDiffOpen((v) => !v);
        return;
      }
      if (command === "tasks.toggle") {
        e.preventDefault();
        e.stopPropagation();
        setTasksOpen((v) => !v);
        return;
      }
      if (command === "plan.toggle") {
        if (terminalFocus) return;
        e.preventDefault();
        e.stopPropagation();
        setPlanOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commandForEvent, terminalOpen]);

  const hasProjects = state.projects.length > 0;
  const activeCwd = active ? threadCwd(active.project, active.thread) : "";
  const activePlan = active ? latestProposedPlan(active.thread) : null;
  const terminalContexts = active
    ? (terminalContextsByThread[active.thread.id] ?? [])
    : [];

  const addTerminalContext = (selection: TerminalContextSelection) => {
    if (!active) return;
    const normalized = normalizeTerminalContextSelection(selection);
    if (!normalized) return;
    const threadId = active.thread.id;
    setTerminalContextsByThread((current) => {
      const existing = current[threadId] ?? [];
      const dedupKey = terminalContextDedupKey(normalized);
      if (existing.some((context) => terminalContextDedupKey(context) === dedupKey)) {
        return current;
      }
      const nextContext: TerminalContextDraft = {
        ...normalized,
        id: newId("termctx"),
        threadId,
        createdAt: Date.now(),
      };
      return { ...current, [threadId]: [...existing, nextContext] };
    });
  };

  const removeTerminalContext = (id: string) => {
    if (!active) return;
    const threadId = active.thread.id;
    setTerminalContextsByThread((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((context) => context.id !== id),
    }));
  };

  const clearTerminalContexts = (threadId: string) => {
    setTerminalContextsByThread((current) => {
      if (!current[threadId]?.length) return current;
      return { ...current, [threadId]: [] };
    });
  };

  useEffect(() => {
    if (!activePlan) return;
    if (activePlan.messageId === lastAutoOpenedPlanId.current) return;
    lastAutoOpenedPlanId.current = activePlan.messageId;
    setPlanOpen(true);
  }, [activePlan?.messageId]);

  if (!hasProjects) {
    return <Welcome onOpenSettings={onOpenSettings} onOpenCloneProject={onOpenCloneProject} />;
  }

  const composerProps = {
    locked,
    onToggleLock: toggleLock,
    tasksOpen,
    onToggleTasks: toggleTasks,
    diffOpen,
    onToggleDiff: toggleDiff,
    terminalOpen,
    onToggleTerminal: toggleTerminal,
    terminalContexts,
    onRemoveTerminalContext: removeTerminalContext,
    onClearTerminalContexts: clearTerminalContexts,
    planOpen,
    onTogglePlan: togglePlan,
  };
  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <main className="flex flex-1 min-h-0 flex-col bg-canvas overflow-hidden">
        {active ? (
          <>
            <ChatHeader thread={active.thread} project={active.project} />
            <GitStatusBar thread={active.thread} project={active.project} />
            <ChangedFiles thread={active.thread} cwd={activeCwd} />
            {active.thread.messages.length === 0 ? (
              <FreshThreadHint />
            ) : (
              <MessageList thread={active.thread} locked={locked} cwd={activeCwd} />
            )}
            <PlanFollowUp thread={active.thread} />
            <Composer {...composerProps} />
            {terminalOpen && (
              <TerminalDrawer
                thread={active.thread}
                project={active.project}
                onHide={() => setTerminalOpen(false)}
                onAttachContext={addTerminalContext}
              />
            )}
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
      {planOpen && active && (
        <PlanSidebar
          project={active.project}
          thread={active.thread}
          onClose={() => setPlanOpen(false)}
        />
      )}
      {diffOpen && active && (
        <DiffPanel
          project={active.project}
          thread={active.thread}
          onClose={() => setDiffOpen(false)}
        />
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

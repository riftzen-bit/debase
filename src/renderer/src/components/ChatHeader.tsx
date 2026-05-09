import { useEffect, useMemo, useState } from "react";
import type { Project, Thread } from "../state/types";
import { useStore } from "../state/store";
import { findModel } from "@shared/providers";
import { relativeTime, truncate } from "../lib/format";
import { AgentIcon, ClaudeMark, PinIcon, TrashIcon } from "./icons";

type Props = {
  thread: Thread;
  project: Project;
};

export function ChatHeader({ thread, project }: Props) {
  const { renameThread, deleteThread, setThreadPinned, selectThread, state } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const isPending = state.pendings[thread.id] != null;

  // Build the list of all currently-running threads (the "parallel agents"
  // indicator). The active thread is included so the user can see at a
  // glance which agents are alive — not just the others.
  const runningAgents = useMemo(() => {
    const agents: { thread: Thread; project: Project; isActive: boolean }[] = [];
    for (const p of state.projects) {
      for (const t of p.threads) {
        if (state.pendings[t.id]) {
          agents.push({ thread: t, project: p, isActive: t.id === thread.id });
        }
      }
    }
    return agents;
  }, [state.projects, state.pendings, thread.id]);

  // Reset the rename-input draft when the active thread changes; otherwise
  // the previous thread's title leaks into the new thread's edit state and
  // a "commit" would silently rename the wrong thread.
  useEffect(() => {
    setEditing(false);
    setDraft(thread.title);
  }, [thread.id, thread.title]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== thread.title) {
      renameThread(thread.id, next);
    } else {
      setDraft(thread.title);
    }
  };

  const model = findModel(thread.runConfig.model);

  return (
    <header className="border-b border-rule bg-canvas">
      {runningAgents.length > 1 && (
        <div className="border-b border-rule/60 bg-surface/30">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-6 py-2">
            <span className="font-mono text-[11px] italic text-ink-3">
              {runningAgents.length} agents working
            </span>
            <span className="text-ink-4">·</span>
            <ul className="flex flex-wrap items-center gap-1.5">
              {runningAgents.map(({ thread: t, project: p, isActive }) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => selectThread(t.id)}
                    title={`${p.name} · ${t.title}`}
                    className={`group inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors ${
                      isActive
                        ? "border-accent/60 bg-accent-soft/60 text-accent-deep"
                        : "border-rule bg-canvas text-ink-2 hover:border-rule-strong hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <span className="dot-cycle inline-block h-1.5 w-1.5 shrink-0 rounded-full" />
                    <span className="text-ink-3 group-hover:text-ink-2">
                      <AgentIcon size={11} />
                    </span>
                    <span className="truncate text-[11.5px]">
                      {truncate(t.title || "Untitled", 28)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(thread.title);
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-[15px] text-ink outline-none ring-1 ring-rule-strong"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(thread.title);
                setEditing(true);
              }}
              className="truncate text-left text-[15px] text-ink hover:text-accent-deep"
              title="Rename"
            >
              {thread.title || "Untitled"}
            </button>
          )}
          <span className="hidden items-center gap-1.5 rounded-sm border border-rule px-1.5 py-0.5 text-[10.5px] text-ink-2 sm:inline-flex">
            <span className="text-ink-3">in</span>
            <span className="font-mono">{project.name}</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setThreadPinned(thread.id, !thread.pinned)}
            title={thread.pinned ? "Unpin thread" : "Pin thread"}
            aria-label={thread.pinned ? "Unpin thread" : "Pin thread"}
            className={`flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${
              thread.pinned
                ? "text-accent hover:text-accent-deep"
                : "text-ink-3 hover:bg-surface hover:text-ink-2"
            }`}
          >
            <PinIcon size={13} />
          </button>
          <button
            type="button"
            onClick={() => deleteThread(thread.id)}
            title="Delete thread"
            aria-label="Delete thread"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-error"
          >
            <TrashIcon size={13} />
          </button>
          <span className="mx-1 h-4 w-px bg-rule" />
          <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <ClaudeMark size={11} />
              <span className="font-mono">{model?.displayName ?? thread.runConfig.model}</span>
            </span>
            <span>·</span>
            <span>{thread.messages.length} msg</span>
            <span>·</span>
            <span>{relativeTime(thread.updatedAt)}</span>
            <span>·</span>
            <span className={isPending ? "text-accent" : "text-ink-3"}>
              {isPending ? "running" : "idle"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

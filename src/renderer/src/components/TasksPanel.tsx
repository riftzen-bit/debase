import type { AssistantBlock, Thread } from "../state/types";
import { CheckIcon, CloseIcon } from "./icons";

type TodoStatus = "pending" | "in_progress" | "completed";

type Todo = {
  content: string;
  status: TodoStatus;
  activeForm: string;
};

type Props = {
  thread: Thread | null;
  onClose: () => void;
};

/**
 * "Tasks" — surfaces the agent's most recent TodoWrite call as an editorial
 * timeline. The reference (t3 code) uses dark cards with strike-through
 * completed steps; we go quieter: a hairline left-rule joins the rows, the
 * in-progress task uses the project's `dot-cycle` for live colour, and a
 * thin progress bar at the top tracks completion ratio. Empty state ships
 * a draft that explains how the panel populates so a fresh thread doesn't
 * just look like an empty drawer.
 */
export function TasksPanel({ thread, onClose }: Props) {
  const todos = thread ? extractLatestTodos(thread) : null;
  const counts = countTodos(todos);

  return (
    <aside
      role="region"
      aria-label="Tasks"
      className="flex h-full min-h-0 flex-col border-l border-rule bg-surface/30 overflow-hidden"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-ink">Tasks</span>
          {todos && todos.length > 0 && (
            <span className="font-mono text-[11px] text-ink-3">
              {counts.completed}/{todos.length} done
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close Tasks panel"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-ink"
        >
          <CloseIcon size={12} />
        </button>
      </header>

      {todos && todos.length > 0 && (
        <div className="shrink-0 border-b border-rule/60 px-4 py-2.5">
          <ProgressBar completed={counts.completed} total={todos.length} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!thread || !todos || todos.length === 0 ? (
          <EmptyState />
        ) : (
          <ol className="relative">
            <span
              aria-hidden
              className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-rule"
            />
            {todos.map((t, i) => (
              <TodoRow key={i} todo={t} index={i} total={todos.length} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function TodoRow({ todo, index, total }: { todo: Todo; index: number; total: number }) {
  const isCompleted = todo.status === "completed";
  const isInProgress = todo.status === "in_progress";
  const label = isInProgress ? todo.activeForm || todo.content : todo.content;

  return (
    <li
      className={`relative flex items-start gap-3 ${index === total - 1 ? "pb-0" : "pb-3"}`}
    >
      <span className="relative z-[1] mt-1 flex h-3 w-3 shrink-0 items-center justify-center">
        {isCompleted ? (
          <span className="flex h-3 w-3 items-center justify-center rounded-full bg-accent text-canvas">
            <CheckIcon size={9} strokeWidth={2} />
          </span>
        ) : isInProgress ? (
          <span className="dot-cycle h-2.5 w-2.5 rounded-full ring-2 ring-canvas" />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full border border-rule-strong bg-canvas" />
        )}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p
          className={`text-[12.5px] leading-snug ${
            isCompleted
              ? "text-ink-3 line-through decoration-ink-4/60"
              : isInProgress
                ? "text-ink"
                : "text-ink-2"
          }`}
        >
          {label}
        </p>
        {isInProgress && (
          <p className="mt-0.5 font-mono text-[10.5px] italic text-accent-deep">
            in progress
          </p>
        )}
      </div>
    </li>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px] text-ink-3">
        <span className="font-mono">{pct}%</span>
        <span className="font-mono italic">
          {completed} of {total}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-rule">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-start gap-3 pt-6 text-[12.5px] leading-relaxed text-ink-3">
      <p className="font-mono italic text-ink-3">no tasks yet</p>
      <p className="max-w-xs">
        When the agent tracks a multi-step plan with the{" "}
        <span className="font-mono text-ink-2">TodoWrite</span> tool, its checklist appears
        here — completed steps strike through, the active step pulses, and pending steps
        sit quietly until they're picked up.
      </p>
    </div>
  );
}

function extractLatestTodos(thread: Thread): Todo[] | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.role !== "assistant") continue;
    for (let j = m.blocks.length - 1; j >= 0; j--) {
      const b: AssistantBlock = m.blocks[j]!;
      if (b.kind !== "tool_use") continue;
      if (b.name !== "TodoWrite") continue;
      const todos = parseTodos(b.input);
      if (todos) return todos;
    }
  }
  return null;
}

function parseTodos(input: unknown): Todo[] | null {
  if (!input || typeof input !== "object") return null;
  const list = (input as { todos?: unknown }).todos;
  if (!Array.isArray(list)) return null;
  const out: Todo[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const t = item as { content?: unknown; status?: unknown; activeForm?: unknown };
    const content = typeof t.content === "string" ? t.content : "";
    const status = isStatus(t.status) ? t.status : "pending";
    const activeForm = typeof t.activeForm === "string" ? t.activeForm : content;
    if (!content) continue;
    out.push({ content, status, activeForm });
  }
  return out;
}

function isStatus(v: unknown): v is TodoStatus {
  return v === "pending" || v === "in_progress" || v === "completed";
}

function countTodos(todos: Todo[] | null): {
  completed: number;
  inProgress: number;
  pending: number;
} {
  if (!todos) return { completed: 0, inProgress: 0, pending: 0 };
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const t of todos) {
    if (t.status === "completed") completed += 1;
    else if (t.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { completed, inProgress, pending };
}

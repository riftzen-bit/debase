import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useActiveThread, useStore } from "../state/store";
import {
  ChevronDownIcon,
  CloseIcon,
  LockIcon,
  LockOpenIcon,
  PaperPlaneIcon,
  SparkleIcon,
  StopIcon,
  TasksIcon,
} from "./icons";
import { MenuItem, MenuLabel, Popover } from "./Popover";
import { RunControls } from "./RunControls";
import { truncate } from "../lib/format";

type SendMode = "queue" | "now";
const SEND_MODE_KEY = "debase.composer.sendMode";

function readSendMode(): SendMode {
  try {
    const raw = localStorage.getItem(SEND_MODE_KEY);
    if (raw === "queue" || raw === "now") return raw;
  } catch {
    /* ignore */
  }
  return "queue";
}

function writeSendMode(mode: SendMode): void {
  try {
    localStorage.setItem(SEND_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

type Props = {
  /** "Follow latest output" — owned by ChatPanel, surfaced as a pill here. */
  locked: boolean;
  onToggleLock: () => void;
  /** Tasks panel visibility (right-side TodoWrite mirror). */
  tasksOpen: boolean;
  onToggleTasks: () => void;
};

export function Composer({ locked, onToggleLock, tasksOpen, onToggleTasks }: Props) {
  const {
    state,
    sendPrompt,
    sendNow,
    enqueuePrompt,
    clearQueue,
    cancelPrompt,
    updateThreadRunConfig,
  } = useStore();
  const active = useActiveThread();
  const [draft, setDraft] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>(readSendMode);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const hasThread = active !== null;
  const threadPending = active ? state.pendings[active.thread.id] != null : false;
  const queuedPrompt = active?.thread.queuedPrompt ?? null;
  const trimmed = draft.trim();
  const isUltrathink = /\bultrathink\b/i.test(draft);

  useEffect(() => {
    autoResize(taRef.current);
  }, [draft]);

  useEffect(() => {
    if (hasThread) {
      taRef.current?.focus();
    }
  }, [hasThread, state.selectedThreadId]);

  useEffect(() => {
    writeSendMode(sendMode);
  }, [sendMode]);

  if (!hasThread) {
    return (
      <div className="border-t border-rule bg-canvas">
        <div className="mx-auto max-w-3xl px-6 py-3 text-[12.5px] text-ink-3">
          Pick a project on the left and start a thread to begin.
        </div>
      </div>
    );
  }

  const { thread } = active;

  const submit = async (mode: SendMode) => {
    if (!trimmed) return;
    if (!threadPending) {
      // Idle thread: just send normally.
      const text = draft;
      setDraft("");
      const status = await sendPrompt(text);
      if (status === "failed") setDraft(text);
      return;
    }
    if (mode === "queue") {
      enqueuePrompt(trimmed, thread.id);
      setDraft("");
      return;
    }
    // mode === "now": cancel current + send new with same session.
    const text = draft;
    setDraft("");
    const status = await sendNow(text, thread.id);
    if (status === "failed") setDraft(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition: when typing Vietnamese (Unikey/Telex/VNI), Chinese,
    // Japanese, or Korean, Enter ends the composition rather than submitting
    // the message. `isComposing` is the modern signal; keyCode 229 is the
    // legacy fallback some platforms still emit.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Enter" && !e.shiftKey) {
      // Plain Enter or Cmd/Ctrl+Enter both submit. Cmd/Ctrl+Enter is the
      // "always send" shortcut some people prefer; plain Enter respects the
      // user's chosen send-mode (queue vs now) when the thread is busy.
      e.preventDefault();
      void submit(mod ? "now" : sendMode);
    }
  };

  const buttonDisabled = trimmed.length === 0;

  return (
    <div className="border-t border-rule bg-canvas">
      <div className="mx-auto max-w-3xl px-4 py-3">
        {queuedPrompt && (
          <QueuedBanner
            text={queuedPrompt}
            onCancel={() => clearQueue(thread.id)}
          />
        )}

        <div
          className={`flex flex-col gap-0 rounded-xl shadow-sm ${
            isUltrathink
              ? "ultrathink-frame"
              : `border bg-surface/40 transition-colors ${
                  threadPending
                    ? "border-accent/60"
                    : "border-rule focus-within:border-rule-strong"
                }`
          }`}
        >
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              threadPending
                ? "Type to queue or send now…"
                : "Ask Claude anything…"
            }
            rows={1}
            className="block w-full resize-none rounded-t-xl bg-transparent px-4 pt-3.5 pb-3 font-mono text-[13.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-1.5 border-t border-rule/60 px-2.5 py-2">
            <RunControls
              runConfig={thread.runConfig}
              disabled={threadPending}
              ultrathink={isUltrathink}
              onChange={(next) => updateThreadRunConfig(thread.id, next)}
            />

            <div className="ml-auto flex items-center gap-2">
              <TasksToggle open={tasksOpen} onToggle={onToggleTasks} />
              <LockToggle locked={locked} onToggle={onToggleLock} />

              {isUltrathink && (
                <span className="hidden items-center gap-1 rounded-md border border-accent/40 bg-accent-soft/40 px-2 py-0.5 text-[11px] text-accent-deep sm:inline-flex ultrathink-hue">
                  <SparkleIcon size={10} />
                  <span className="font-mono">ultrathink</span>
                </span>
              )}

              {threadPending && (
                <button
                  type="button"
                  onClick={() => void cancelPrompt(thread.id)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-error/40 bg-error-soft/60 px-2.5 text-[12px] text-error transition-colors hover:bg-error-soft"
                >
                  <StopIcon size={11} />
                  Stop
                </button>
              )}
              {threadPending && trimmed.length > 0 ? (
                <SendSplitButton
                  mode={sendMode}
                  onSubmit={(m) => void submit(m)}
                  onChangeMode={(m) => setSendMode(m)}
                />
              ) : !threadPending ? (
                <button
                  type="button"
                  onClick={() => void submit("queue" /* unused when idle */)}
                  disabled={buttonDisabled}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/50 bg-accent-soft/60 px-3 text-[12px] text-accent-deep transition-colors hover:border-accent/80 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PaperPlaneIcon size={11} />
                  Send
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10.5px] text-ink-3">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono text-ink-2">↵</kbd>{" "}
              {threadPending ? (sendMode === "queue" ? "queue" : "send now") : "send"}
            </span>
            <span>
              <kbd className="font-mono text-ink-2">⇧↵</kbd> newline
            </span>
            {threadPending && (
              <span>
                <kbd className="font-mono text-ink-2">⌘↵</kbd> send now
              </span>
            )}
          </div>
          <PathHint />
        </div>
      </div>
    </div>
  );
}

function TasksToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={open ? "Hide Tasks panel" : "Show Tasks panel"}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
        open
          ? "border-accent/60 bg-accent-soft/60 text-accent-deep hover:bg-accent-soft"
          : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
      }`}
    >
      <TasksIcon size={12} />
      <span className="font-mono">tasks</span>
    </button>
  );
}

function LockToggle({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={locked}
      title={
        locked
          ? "Auto-following the latest output — click to unlock"
          : "Click to lock to the bottom while the agent streams"
      }
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
        locked
          ? "border-accent/60 bg-accent-soft/60 text-accent-deep hover:bg-accent-soft"
          : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
      }`}
    >
      {locked ? <LockIcon size={11} /> : <LockOpenIcon size={11} />}
      <span className="font-mono">{locked ? "locked" : "lock"}</span>
    </button>
  );
}

function QueuedBanner({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-rule bg-surface/40 px-3 py-1.5 text-[12px]">
      <span className="font-mono text-[10.5px] italic text-ink-3">
        queued
      </span>
      <span className="line-clamp-1 flex-1 text-ink-2">{truncate(text, 120)}</span>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-5 w-5 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        title="Cancel queued message"
        aria-label="Cancel queued message"
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

function SendSplitButton({
  mode,
  onSubmit,
  onChangeMode,
}: {
  mode: SendMode;
  onSubmit: (mode: SendMode) => void;
  onChangeMode: (mode: SendMode) => void;
}) {
  const label = mode === "queue" ? "Queue" : "Send now";
  // Each button carries its own border so we can drop `overflow-hidden` on
  // the wrapper. Earlier the wrapper clipped the popover panel — the click
  // *did* toggle, but you couldn't see the menu.
  return (
    <div className="inline-flex items-stretch text-[12px] text-accent-deep">
      <button
        type="button"
        onClick={() => onSubmit(mode)}
        className="inline-flex h-7 items-center gap-1.5 rounded-l-md border border-r-0 border-accent/50 bg-accent-soft/60 px-3 transition-colors hover:bg-accent-soft"
      >
        <PaperPlaneIcon size={11} />
        {label}
      </button>
      <Popover
        align="end"
        width={260}
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label="Send mode"
            aria-expanded={open}
            className={`inline-flex h-7 items-center rounded-r-md border border-accent/50 px-1.5 transition-colors ${
              open ? "bg-accent-soft" : "bg-accent-soft/60 hover:bg-accent-soft"
            }`}
          >
            <ChevronDownIcon size={11} />
          </button>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>While the agent runs</MenuLabel>
            <MenuItem
              active={mode === "queue"}
              onClick={() => {
                onChangeMode("queue");
                close();
              }}
              hint="Wait for the current turn to finish, then send."
            >
              Queue
            </MenuItem>
            <MenuItem
              active={mode === "now"}
              onClick={() => {
                onChangeMode("now");
                close();
              }}
              hint="Interrupt the current turn and send immediately. The session resumes so context isn't lost."
            >
              Send now
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  );
}

function PathHint() {
  const active = useActiveThread();
  if (!active) return null;
  const { project } = active;
  if (!project.path) return <span>no working directory</span>;
  return <span className="truncate font-mono">cwd · {project.path}</span>;
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  const max = 240;
  el.style.height = Math.min(el.scrollHeight, max) + "px";
}

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ChatMessage } from "../state/types";
import { useActiveThread, useStore } from "../state/store";
import {
  ArchiveIcon,
  ChevronDownIcon,
  CloseIcon,
  ComposeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GearIcon,
  LockIcon,
  LockOpenIcon,
  PaperPlaneIcon,
  SparkleIcon,
  StopIcon,
  TasksIcon,
} from "./icons";
import { MenuItem, MenuLabel, Popover } from "./Popover";
import { RunControls } from "./RunControls";
import {
  SlashCommandMenu,
  filterSlashCommands,
  type SlashCommand,
} from "./SlashCommandMenu";
import { truncate } from "../lib/format";
import { PROVIDER_META } from "@shared/providers";

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
    setThreadDraft,
    newThread,
    setThreadArchived,
  } = useStore();
  const active = useActiveThread();
  const draft = active?.thread.draft ?? "";
  const setDraft = (next: string) => {
    if (!active) return;
    setThreadDraft(active.thread.id, next.length > 0 ? next : null);
  };
  const [sendMode, setSendMode] = useState<SendMode>(readSendMode);
  const [slashIndex, setSlashIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const hasThread = active !== null;
  const threadPending = active ? state.pendings[active.thread.id] != null : false;
  const queuedPrompt = active?.thread.queuedPrompt ?? null;
  const trimmed = draft.trim();
  const isUltrathink = /\bultrathink\b/i.test(draft);
  // Match against raw draft (no trim) so a trailing space dismisses the
  // menu — once the user has typed past the command, they're writing prose.
  const slashOpen = /^\/[\w-]*$/.test(draft);
  const slashQuery = slashOpen ? draft.slice(1) : "";
  const atOpen = draft === "@";

  useEffect(() => {
    autoResize(taRef.current);
  }, [draft]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery, slashOpen]);

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

  const { thread, project } = active;
  const providerLabel = PROVIDER_META[thread.runConfig.provider].shortLabel;

  const slashCommands: SlashCommand[] = [
    {
      id: "clear",
      trigger: "/clear",
      description: "Start a fresh thread in this project",
      icon: <ComposeIcon size={12} />,
      run: () => {
        setDraft("");
        newThread(project.id);
      },
    },
    {
      id: "archive",
      trigger: "/archive",
      description: "Archive this thread",
      icon: <ArchiveIcon size={12} />,
      run: () => {
        setDraft("");
        setThreadArchived(thread.id, true);
      },
    },
    {
      id: "copy",
      trigger: "/copy",
      description: "Copy the latest assistant message",
      icon: <CopyIcon size={12} />,
      disabled: lastAssistantText(thread.messages).length === 0,
      run: () => {
        const text = lastAssistantText(thread.messages);
        if (text) {
          void navigator.clipboard.writeText(text).catch(() => {
            /* ignore — clipboard may be unavailable */
          });
        }
        setDraft("");
      },
    },
    {
      id: "cwd",
      trigger: "/cwd",
      description: "Open project folder",
      hint: project.path || "no path",
      icon: <ExternalLinkIcon size={12} />,
      disabled: !project.path,
      run: () => {
        if (project.path) void window.api.shell.openPath(project.path);
        setDraft("");
      },
    },
    {
      id: "edit",
      trigger: "/edit",
      description: "Open project in your editor",
      hint: state.settings.editorCommand ? state.settings.editorCommand : "configure in settings",
      icon: <ExternalLinkIcon size={12} />,
      disabled: !project.path || !state.settings.editorCommand,
      run: () => {
        if (project.path && state.settings.editorCommand) {
          void window.api.shell.openInEditor({
            editorCommand: state.settings.editorCommand,
            path: project.path,
          });
        }
        setDraft("");
      },
    },
    {
      id: "lock",
      trigger: "/lock",
      description: locked ? "Stop following latest output" : "Follow latest output",
      icon: locked ? <LockIcon size={12} /> : <LockOpenIcon size={12} />,
      run: () => {
        onToggleLock();
        setDraft("");
      },
    },
    {
      id: "tasks",
      trigger: "/tasks",
      description: tasksOpen ? "Hide tasks panel" : "Show tasks panel",
      icon: <TasksIcon size={12} />,
      run: () => {
        onToggleTasks();
        setDraft("");
      },
    },
    {
      id: "full-access",
      trigger: "/full-access",
      description: thread.runConfig.fullAccess
        ? "Disable bypass-permissions mode"
        : "Bypass permission prompts (dangerous)",
      icon: <GearIcon size={12} />,
      run: () => {
        updateThreadRunConfig(thread.id, { fullAccess: !thread.runConfig.fullAccess });
        setDraft("");
      },
    },
    {
      id: "plan",
      trigger: "/plan",
      description: "Switch to plan mode",
      hint: thread.runConfig.mode === "plan" ? "active" : undefined,
      run: () => {
        updateThreadRunConfig(thread.id, { mode: "plan" });
        setDraft("");
      },
    },
    {
      id: "build",
      trigger: "/build",
      description: "Switch to build mode",
      hint: thread.runConfig.mode === "build" ? "active" : undefined,
      run: () => {
        updateThreadRunConfig(thread.id, { mode: "build" });
        setDraft("");
      },
    },
    {
      id: "auto-edit",
      trigger: "/auto-edit",
      description: "Switch to auto-edit mode",
      hint: thread.runConfig.mode === "auto-edit" ? "active" : undefined,
      run: () => {
        updateThreadRunConfig(thread.id, { mode: "auto-edit" });
        setDraft("");
      },
    },
    {
      id: "auto",
      trigger: "/auto",
      description: "Switch to auto mode",
      hint: thread.runConfig.mode === "auto" ? "active" : undefined,
      run: () => {
        updateThreadRunConfig(thread.id, { mode: "auto" });
        setDraft("");
      },
    },
  ];

  const filteredSlash = filterSlashCommands(slashCommands, slashQuery);

  const pickFiles = async () => {
    const result = await window.api.dialog.chooseFiles({
      defaultPath: project.path || undefined,
      multi: true,
    });
    if (!result.ok) return;
    const formatted = result.paths.map((p) => formatMentionPath(p, project.path)).join(" ");
    setDraft(formatted);
    taRef.current?.focus();
  };

  const appendMention = (path: string) => {
    const token = formatMentionPath(path, project.path);
    const current = active.thread.draft ?? "";
    const sep = current.length > 0 && !/\s$/.test(current) ? " " : "";
    setDraft(current + sep + token + " ");
  };

  const handleImageFile = async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const ext = (file.type.split("/")[1] || "png").toLowerCase();
      const res = await window.api.attachments.saveImage({ base64, extension: ext });
      if (res.ok) appendMention(res.path);
    } catch {
      // Swallow — clipboard/drag images that fail to read shouldn't crash
      // the composer. The user can retry.
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) images.push(f);
      }
    }
    if (images.length === 0) return;
    e.preventDefault();
    for (const f of images) void handleImageFile(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files);
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        void handleImageFile(file);
      } else {
        // Electron exposes the OS path on dropped files via this non-standard
        // property. If present, we treat it like a normal `@`-mention.
        const path = (file as File & { path?: string }).path;
        if (path) appendMention(path);
      }
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
    }
  };

  const submit = async (mode: SendMode) => {
    if (!trimmed) return;
    // Pin the destination thread up-front so a mid-await thread switch can't
    // redirect this send to whichever thread is currently selected.
    const targetThreadId = thread.id;
    if (!threadPending) {
      const text = draft;
      setDraft("");
      const status = await sendPrompt(text, targetThreadId);
      if (status === "failed") setDraft(text);
      return;
    }
    if (mode === "queue") {
      enqueuePrompt(trimmed, targetThreadId);
      setDraft("");
      return;
    }
    // mode === "now": cancel current + send new with same session.
    const text = draft;
    setDraft("");
    const status = await sendNow(text, targetThreadId);
    if (status === "failed") setDraft(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition: when typing Vietnamese (Unikey/Telex/VNI), Chinese,
    // Japanese, or Korean, Enter ends the composition rather than submitting
    // the message. `isComposing` is the modern signal; keyCode 229 is the
    // legacy fallback some platforms still emit.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;

    if (slashOpen && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(filteredSlash.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const cmd = filteredSlash[slashIndex];
        if (cmd && !cmd.disabled) cmd.run();
        return;
      }
    }

    if (atOpen && e.key === "Tab") {
      e.preventDefault();
      void pickFiles();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      // Plain Enter or Cmd/Ctrl+Enter both submit. Cmd/Ctrl+Enter is the
      // "always send" shortcut some people prefer; plain Enter respects the
      // user's chosen send-mode (queue vs now) when the thread is busy.
      e.preventDefault();
      void submit(mod ? "now" : sendMode);
      return;
    }
    if (e.key === "Escape") {
      if (queuedPrompt) {
        e.preventDefault();
        clearQueue(thread.id);
        return;
      }
      if (draft.length > 0) {
        e.preventDefault();
        setDraft("");
        return;
      }
    }
    if (e.key === "ArrowUp" && draft.length === 0 && !mod && !e.shiftKey && !e.altKey) {
      const last = lastUserPrompt(thread.messages);
      if (last) {
        e.preventDefault();
        setDraft(last);
      }
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
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`relative flex flex-col gap-0 rounded-xl shadow-sm ${
            isUltrathink
              ? "ultrathink-frame"
              : `border bg-surface/40 transition-colors ${
                  threadPending
                    ? "border-accent/60"
                    : "border-rule focus-within:border-rule-strong"
                }`
          }`}
        >
          <SlashCommandMenu
            open={slashOpen}
            query={slashQuery}
            commands={filteredSlash}
            active={slashIndex}
            onActiveChange={setSlashIndex}
            onSelect={(cmd) => {
              if (!cmd.disabled) cmd.run();
              taRef.current?.focus();
            }}
          />
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={
              threadPending
                ? "Type to queue or send now…"
                : `Ask ${providerLabel} anything · / for commands · @ to attach files`
            }
            rows={1}
            className="block w-full resize-none rounded-t-xl bg-transparent px-4 pt-3.5 pb-3 font-mono text-[13.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
          />

          <div className="flex items-start gap-2 border-t border-rule/60 px-2.5 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <RunControls
                runConfig={thread.runConfig}
                disabled={threadPending}
                enabledProviders={state.settings.enabledProviders}
                ultrathink={isUltrathink}
                onChange={(next) => updateThreadRunConfig(thread.id, next)}
              />
              {isUltrathink && (
                <span className="hidden items-center gap-1 rounded-md border border-accent/40 bg-accent-soft/40 px-2 py-0.5 text-[11px] text-accent-deep sm:inline-flex ultrathink-hue">
                  <SparkleIcon size={10} />
                  <span className="font-mono">ultrathink</span>
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <TasksToggle open={tasksOpen} onToggle={onToggleTasks} />
              <LockToggle locked={locked} onToggle={onToggleLock} />

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
            {atOpen ? (
              <span className="text-accent-deep">
                <kbd className="font-mono">tab</kbd> pick a file
              </span>
            ) : (
              <>
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
              </>
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

function formatMentionPath(filePath: string, projectPath: string): string {
  if (!projectPath) return `@${filePath}`;
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const f = norm(filePath);
  const p = norm(projectPath);
  if (f.toLowerCase().startsWith(p.toLowerCase() + "/")) {
    return `@${f.slice(p.length + 1)}`;
  }
  return `@${f}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

function lastUserPrompt(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && m.text.length > 0) return m.text;
  }
  return null;
}

function lastAssistantText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = m.blocks
      .filter((b): b is Extract<typeof b, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return "";
}

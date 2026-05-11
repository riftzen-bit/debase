import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ChatMessage } from "../state/types";
import type { ProjectFileSearchEntry, ProjectSkillEntry } from "@shared/chat";
import { useActiveThread, useStore } from "../state/store";
import {
  ArchiveIcon,
  ChevronDownIcon,
  CloseIcon,
  ComposeIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  GearIcon,
  LockIcon,
  LockOpenIcon,
  PaperPlaneIcon,
  SparkleIcon,
  StopIcon,
  TasksIcon,
  TerminalIcon,
  DiffIcon,
} from "./icons";
import { MenuItem, MenuLabel, Popover } from "./Popover";
import { RunControls } from "./RunControls";
import {
  SlashCommandMenu,
  filterSlashCommands,
  type SlashCommand,
} from "./SlashCommandMenu";
import { truncate } from "../lib/format";
import { FileIcon } from "../lib/fileIcons";
import { threadCwd } from "../lib/workdir";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  type TerminalContextDraft,
} from "../lib/terminalContext";
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
  /** Plan panel visibility (latest plan-mode answer). */
  planOpen: boolean;
  onTogglePlan: () => void;
  /** Git working-tree diff panel visibility. */
  diffOpen: boolean;
  onToggleDiff: () => void;
  /** Bottom PTY drawer, scoped to the current thread cwd. */
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  terminalContexts: TerminalContextDraft[];
  onRemoveTerminalContext: (id: string) => void;
  onClearTerminalContexts: (threadId: string) => void;
};

export function Composer({
  locked,
  onToggleLock,
  tasksOpen,
  onToggleTasks,
  planOpen,
  onTogglePlan,
  diffOpen,
  onToggleDiff,
  terminalOpen,
  onToggleTerminal,
  terminalContexts,
  onRemoveTerminalContext,
  onClearTerminalContexts,
}: Props) {
  const {
    state,
    providerCatalog,
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
  const [mentionIndex, setMentionIndex] = useState(0);
  const [skillIndex, setSkillIndex] = useState(0);
  const [mentionEntries, setMentionEntries] = useState<ProjectFileSearchEntry[]>([]);
  const [skillEntries, setSkillEntries] = useState<ProjectSkillEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mentionSearchSeq = useRef(0);
  const skillSearchSeq = useRef(0);

  const hasThread = active !== null;
  const cwd = active ? threadCwd(active.project, active.thread) : "";
  const threadPending = active ? state.pendings[active.thread.id] != null : false;
  const queuedPrompt = active?.thread.queuedPrompt ?? null;
  const trimmed = draft.trim();
  const hasTerminalContexts = terminalContexts.length > 0;
  const isUltrathink = /\bultrathink\b/i.test(draft);
  // Match against raw draft (no trim) so a trailing space dismisses the
  // menu — once the user has typed past the command, they're writing prose.
  const slashOpen = /^\/[\w-]*$/.test(draft);
  const slashQuery = slashOpen ? draft.slice(1) : "";
  const skillTrigger = !slashOpen ? detectSkillMention(draft, cursor) : null;
  const skillOpen = skillTrigger !== null;
  const skillQuery = skillTrigger?.query ?? "";
  const mentionTrigger = !slashOpen && !skillOpen ? detectPathMention(draft, cursor) : null;
  const mentionOpen = mentionTrigger !== null;
  const mentionQuery = mentionTrigger?.query ?? "";
  const atOpen = mentionOpen && mentionQuery.length === 0;

  useEffect(() => {
    autoResize(taRef.current);
  }, [draft]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery, slashOpen]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionOpen]);

  useEffect(() => {
    setSkillIndex(0);
  }, [skillQuery, skillOpen]);

  useEffect(() => {
    const seq = ++mentionSearchSeq.current;
    if (!mentionOpen || !cwd) {
      setMentionEntries([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.api.project
        .searchFiles({ projectPath: cwd, query: mentionQuery, limit: 30 })
        .then((res) => {
          if (seq !== mentionSearchSeq.current) return;
          setMentionEntries(res.ok ? res.entries : []);
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [cwd, mentionOpen, mentionQuery]);

  useEffect(() => {
    const seq = ++skillSearchSeq.current;
    if (!skillOpen) return;
    const timer = window.setTimeout(() => {
      void window.api.project
        .listSkills({ projectPath: cwd || undefined })
        .then((res) => {
          if (seq !== skillSearchSeq.current) return;
          setSkillEntries(res.ok ? res.skills : []);
        });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [cwd, skillOpen, skillQuery]);

  useEffect(() => {
    if (hasThread) {
      taRef.current?.focus();
      setCursor(taRef.current?.selectionStart ?? draft.length);
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
      hint: cwd || "no path",
      icon: <ExternalLinkIcon size={12} />,
      disabled: !cwd,
      run: () => {
        if (cwd) void window.api.shell.openPath(cwd);
        setDraft("");
      },
    },
    {
      id: "edit",
      trigger: "/edit",
      description: "Open project in your editor",
      hint: state.settings.editorCommand ? state.settings.editorCommand : "configure in settings",
      icon: <ExternalLinkIcon size={12} />,
      disabled: !cwd || !state.settings.editorCommand,
      run: () => {
        if (cwd && state.settings.editorCommand) {
          void window.api.shell.openInEditor({
            editorCommand: state.settings.editorCommand,
            path: cwd,
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
      id: "plans",
      trigger: "/plans",
      description: planOpen ? "Hide plan panel" : "Show latest plan",
      icon: <EyeIcon size={12} />,
      run: () => {
        onTogglePlan();
        setDraft("");
      },
    },
    {
      id: "diff",
      trigger: "/diff",
      description: diffOpen ? "Hide diff panel" : "Show git diff",
      icon: <DiffIcon size={12} />,
      run: () => {
        onToggleDiff();
        setDraft("");
      },
    },
    {
      id: "model",
      trigger: "/model",
      description: "Open model picker",
      icon: <GearIcon size={12} />,
      run: () => {
        window.dispatchEvent(new CustomEvent("debase:toggle-model-picker"));
        setDraft("");
      },
    },
    {
      id: "terminal",
      trigger: "/terminal",
      description: terminalOpen ? "Hide terminal" : "Show terminal",
      icon: <TerminalIcon size={12} />,
      run: () => {
        onToggleTerminal();
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
  const filteredSkills = filterSkillEntries(skillEntries, skillQuery);

  const syncCursor = () => {
    setCursor(taRef.current?.selectionStart ?? draft.length);
  };

  const pickFiles = async () => {
    const result = await window.api.dialog.chooseFiles({
      defaultPath: cwd || undefined,
      multi: true,
    });
    if (!result.ok) return;
    const formatted = result.paths.map((p) => formatMentionPath(p, cwd)).join(" ");
    setDraft(formatted);
    taRef.current?.focus();
  };

  const appendMention = (path: string) => {
    const token = formatMentionPath(path, cwd);
    const current = active.thread.draft ?? "";
    const sep = current.length > 0 && !/\s$/.test(current) ? " " : "";
    setDraft(current + sep + token + " ");
  };

  const insertMentionPath = (relativePath: string) => {
    const trigger = detectPathMention(active.thread.draft ?? "", taRef.current?.selectionStart ?? cursor);
    if (!trigger) {
      appendMention(relativePath);
      return;
    }
    const next = replaceTextRange(active.thread.draft ?? "", trigger.rangeStart, trigger.rangeEnd, `@${relativePath} `);
    setDraft(next.text);
    window.requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
    });
  };

  const insertSkill = (skill: ProjectSkillEntry) => {
    const trigger = detectSkillMention(active.thread.draft ?? "", taRef.current?.selectionStart ?? cursor);
    if (!trigger) return;
    const next = replaceTextRange(
      active.thread.draft ?? "",
      trigger.rangeStart,
      trigger.rangeEnd,
      `$${skill.name} `,
    );
    setDraft(next.text);
    window.requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
    });
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
    if (!trimmed && !hasTerminalContexts) return;
    // Pin the destination thread up-front so a mid-await thread switch can't
    // redirect this send to whichever thread is currently selected.
    const targetThreadId = thread.id;
    const materializedText = appendTerminalContextsToPrompt(draft, terminalContexts);
    if (!threadPending) {
      const text = draft;
      setDraft("");
      const status = await sendPrompt(materializedText, targetThreadId);
      if (status === "failed") setDraft(text);
      else onClearTerminalContexts(targetThreadId);
      return;
    }
    if (mode === "queue") {
      enqueuePrompt(materializedText, targetThreadId);
      setDraft("");
      onClearTerminalContexts(targetThreadId);
      return;
    }
    // mode === "now": cancel current + send new with same session.
    const text = draft;
    setDraft("");
    const status = await sendNow(materializedText, targetThreadId);
    if (status === "failed") setDraft(text);
    else onClearTerminalContexts(targetThreadId);
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

    if (skillOpen) {
      if (e.key === "ArrowDown" && filteredSkills.length > 0) {
        e.preventDefault();
        setSkillIndex((i) => Math.min(filteredSkills.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp" && filteredSkills.length > 0) {
        e.preventDefault();
        setSkillIndex((i) => Math.max(0, i - 1));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && filteredSkills.length > 0) {
        e.preventDefault();
        const skill = filteredSkills[skillIndex];
        if (skill) insertSkill(skill);
        return;
      }
    }

    if (mentionOpen) {
      if (e.key === "ArrowDown" && mentionEntries.length > 0) {
        e.preventDefault();
        setMentionIndex((i) => Math.min(mentionEntries.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp" && mentionEntries.length > 0) {
        e.preventDefault();
        setMentionIndex((i) => Math.max(0, i - 1));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && mentionEntries.length > 0) {
        e.preventDefault();
        const entry = mentionEntries[mentionIndex];
        if (entry) insertMentionPath(entry.path);
        return;
      }
      if (atOpen && e.key === "Tab") {
        e.preventDefault();
        void pickFiles();
        return;
      }
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

  const buttonDisabled = trimmed.length === 0 && !hasTerminalContexts;

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
          <SkillMentionMenu
            open={skillOpen && !slashOpen}
            query={skillQuery}
            entries={filteredSkills}
            active={skillIndex}
            onActiveChange={setSkillIndex}
            onSelect={insertSkill}
          />
          <FileMentionMenu
            open={mentionOpen && !slashOpen && !skillOpen}
            query={mentionQuery}
            entries={mentionEntries}
            active={mentionIndex}
            onActiveChange={setMentionIndex}
            onSelect={(entry) => insertMentionPath(entry.path)}
            onPickFiles={() => void pickFiles()}
          />
          <PendingTerminalContexts
            contexts={terminalContexts}
            onRemove={onRemoveTerminalContext}
          />
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCursor(e.currentTarget.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCursor}
            onClick={syncCursor}
            onSelect={syncCursor}
            onPaste={onPaste}
            placeholder={
              threadPending
                ? "Type to queue or send now…"
                : `Ask ${providerLabel} anything · / commands · @ files · $ skills`
            }
            rows={1}
            className="block w-full resize-none rounded-t-xl bg-transparent px-4 pt-3.5 pb-3 font-mono text-[13.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
          />

          <div className="flex flex-col gap-2 border-t border-rule/60 px-2.5 py-2 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <RunControls
                runConfig={thread.runConfig}
                disabled={threadPending}
                enabledProviders={state.settings.enabledProviders}
                providerCatalog={providerCatalog}
                modelPreferences={state.settings.modelPreferences}
                ultrathink={isUltrathink}
                globalModelPicker
                onChange={(next) => updateThreadRunConfig(thread.id, next)}
              />
              {isUltrathink && (
                <span className="hidden items-center gap-1 rounded-md border border-accent/40 bg-accent-soft/40 px-2 py-0.5 text-[11px] text-accent-deep sm:inline-flex ultrathink-hue">
                  <SparkleIcon size={10} />
                  <span className="font-mono">ultrathink</span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <TerminalToggle open={terminalOpen} onToggle={onToggleTerminal} />
              <DiffToggle open={diffOpen} onToggle={onToggleDiff} />
              <PlanToggle open={planOpen} onToggle={onTogglePlan} />
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
            {skillOpen ? (
              <span className="text-accent-deep">
                <kbd className="font-mono">tab</kbd> choose a skill
              </span>
            ) : atOpen ? (
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

function TerminalToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={open ? "Hide terminal" : "Show terminal"}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
        open
          ? "border-accent/60 bg-accent-soft/60 text-accent-deep hover:bg-accent-soft"
          : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
      }`}
    >
      <TerminalIcon size={12} />
      <span className="font-mono">term</span>
    </button>
  );
}

function DiffToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={open ? "Hide diff panel" : "Show git diff"}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
        open
          ? "border-accent/60 bg-accent-soft/60 text-accent-deep hover:bg-accent-soft"
          : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
      }`}
    >
      <DiffIcon size={12} />
      <span className="font-mono">diff</span>
    </button>
  );
}

function PlanToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={open ? "Hide Plan panel" : "Show latest plan"}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors ${
        open
          ? "border-accent/60 bg-accent-soft/60 text-accent-deep hover:bg-accent-soft"
          : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
      }`}
    >
      <EyeIcon size={12} />
      <span className="font-mono">plan</span>
    </button>
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

function PendingTerminalContexts({
  contexts,
  onRemove,
}: {
  contexts: TerminalContextDraft[];
  onRemove: (id: string) => void;
}) {
  if (contexts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-rule/60 px-3 py-2">
      {contexts.map((context) => (
        <button
          key={context.id}
          type="button"
          title={context.text}
          onClick={() => onRemove(context.id)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-canvas px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface"
        >
          <TerminalIcon size={11} />
          <span className="min-w-0 truncate font-mono">
            {formatTerminalContextLabel(context)}
          </span>
          <CloseIcon size={10} />
        </button>
      ))}
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

function SkillMentionMenu({
  open,
  query,
  entries,
  active,
  onActiveChange,
  onSelect,
}: {
  open: boolean;
  query: string;
  entries: ProjectSkillEntry[];
  active: number;
  onActiveChange: (next: number) => void;
  onSelect: (entry: ProjectSkillEntry) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const child = listRef.current?.children[active] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-30">
      <div className="overflow-hidden rounded-md border border-rule-strong bg-canvas shadow-md">
        <div className="border-b border-rule px-3 py-1.5 font-mono text-[11px] italic text-ink-3">
          skill
          {query && <span className="ml-1.5 not-italic text-ink-2">{query}</span>}
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-ink-3">
            {query ? "No matching skills." : "No local skills found."}
          </div>
        ) : (
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {entries.map((entry, i) => {
              const isActive = i === active;
              return (
                <button
                  key={`${entry.scope}:${entry.path}`}
                  type="button"
                  onMouseEnter={() => onActiveChange(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(entry);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isActive ? "bg-surface" : "hover:bg-surface/60"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-3">
                    <SparkleIcon size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-accent-deep">
                      ${entry.name}
                    </span>
                    {entry.shortDescription && (
                      <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                        {entry.shortDescription}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
                    {entry.scope}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FileMentionMenu({
  open,
  query,
  entries,
  active,
  onActiveChange,
  onSelect,
  onPickFiles,
}: {
  open: boolean;
  query: string;
  entries: ProjectFileSearchEntry[];
  active: number;
  onActiveChange: (next: number) => void;
  onSelect: (entry: ProjectFileSearchEntry) => void;
  onPickFiles: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const child = listRef.current?.children[active] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-30">
      <div className="overflow-hidden rounded-md border border-rule-strong bg-canvas shadow-md">
        <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-1.5">
          <span className="font-mono text-[11px] italic text-ink-3">
            file mention
            {query && <span className="ml-1.5 not-italic text-ink-2">{query}</span>}
          </span>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPickFiles();
            }}
            className="rounded-sm border border-rule bg-surface/40 px-2 py-0.5 text-[10.5px] text-ink-2 transition-colors hover:bg-surface"
          >
            pick file
          </button>
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-ink-3">
            {query ? "No matching files." : "Type to search files, or pick a file."}
          </div>
        ) : (
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {entries.map((entry, i) => {
              const isActive = i === active;
              return (
                <button
                  key={entry.path}
                  type="button"
                  onMouseEnter={() => onActiveChange(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(entry);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isActive ? "bg-surface" : "hover:bg-surface/60"
                  }`}
                >
                  <span className="shrink-0 text-ink-3">
                    <FileIcon name={entry.path} size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
                    {entry.path}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PathHint() {
  const active = useActiveThread();
  if (!active) return null;
  const cwd = threadCwd(active.project, active.thread);
  if (!cwd) return <span>no working directory</span>;
  return <span className="truncate font-mono">cwd · {cwd}</span>;
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

function detectPathMention(
  text: string,
  cursorInput: number,
): { query: string; rangeStart: number; rangeEnd: number } | null {
  const cursor = Math.max(0, Math.min(text.length, Math.floor(cursorInput)));
  const beforeCursor = text.slice(0, cursor);
  const tokenStart = Math.max(
    beforeCursor.lastIndexOf(" "),
    beforeCursor.lastIndexOf("\n"),
    beforeCursor.lastIndexOf("\t"),
  ) + 1;
  const token = text.slice(tokenStart, cursor);
  if (!token.startsWith("@")) return null;
  if (token.slice(1).includes("@")) return null;
  return {
    query: token.slice(1),
    rangeStart: tokenStart,
    rangeEnd: cursor,
  };
}

function detectSkillMention(
  text: string,
  cursorInput: number,
): { query: string; rangeStart: number; rangeEnd: number } | null {
  const cursor = Math.max(0, Math.min(text.length, Math.floor(cursorInput)));
  const beforeCursor = text.slice(0, cursor);
  const tokenStart = Math.max(
    beforeCursor.lastIndexOf(" "),
    beforeCursor.lastIndexOf("\n"),
    beforeCursor.lastIndexOf("\t"),
  ) + 1;
  const token = text.slice(tokenStart, cursor);
  if (!token.startsWith("$")) return null;
  if (token.slice(1).includes("$")) return null;
  return {
    query: token.slice(1),
    rangeStart: tokenStart,
    rangeEnd: cursor,
  };
}

function filterSkillEntries(entries: ProjectSkillEntry[], query: string): ProjectSkillEntry[] {
  const normalized = query.trim().replace(/^\$+/, "").toLowerCase();
  if (!normalized) return entries.slice(0, 40);
  return entries
    .map((entry, index) => {
      const haystack = [
        entry.name,
        entry.displayName,
        entry.shortDescription ?? "",
        entry.description ?? "",
        entry.scope,
      ].join(" ").toLowerCase();
      const name = entry.name.toLowerCase();
      let rank = Number.POSITIVE_INFINITY;
      if (name === normalized) rank = 0;
      else if (name.startsWith(normalized)) rank = 1;
      else if (haystack.includes(normalized)) rank = 2;
      return { entry, index, rank };
    })
    .filter((item) => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 40)
    .map((item) => item.entry);
}

function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
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

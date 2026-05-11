import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Project, Thread } from "../state/types";
import { useCommandForEvent } from "../state/keybindings";
import { threadCwd } from "../lib/workdir";
import {
  CloseIcon,
  CopyIcon,
  PlusIcon,
  ResetIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "./icons";
import { DEFAULT_TERMINAL_ID, type TerminalSessionStatus } from "@shared/terminal";
import type { TerminalContextSelection } from "../lib/terminalContext";

type Props = {
  thread: Thread;
  project: Project;
  onHide: () => void;
  onAttachContext: (selection: TerminalContextSelection) => void;
};

type PaneMeta = {
  status: TerminalSessionStatus;
  pid: number | null;
  error: string | null;
};

const DEFAULT_META: PaneMeta = {
  status: "starting",
  pid: null,
  error: null,
};

type CaptureTerminalContext = () => TerminalContextSelection | null;

export function TerminalDrawer({ thread, project, onHide, onAttachContext }: Props) {
  const cwd = threadCwd(project, thread);
  const commandForEvent = useCommandForEvent();
  const [panes, setPanes] = useState<string[]>([DEFAULT_TERMINAL_ID]);
  const [activeId, setActiveId] = useState(DEFAULT_TERMINAL_ID);
  const [metaById, setMetaById] = useState<Record<string, PaneMeta>>({
    [DEFAULT_TERMINAL_ID]: DEFAULT_META,
  });
  const captureByIdRef = useRef<Record<string, CaptureTerminalContext>>({});

  useEffect(() => {
    setPanes([DEFAULT_TERMINAL_ID]);
    setActiveId(DEFAULT_TERMINAL_ID);
    setMetaById({ [DEFAULT_TERMINAL_ID]: DEFAULT_META });
  }, [thread.id]);

  const updateMeta = useCallback((terminalId: string, next: Partial<PaneMeta>) => {
    setMetaById((current) => ({
      ...current,
      [terminalId]: { ...(current[terminalId] ?? DEFAULT_META), ...next },
    }));
  }, []);

  const addPane = useCallback((focus = true) => {
    setPanes((current) => {
      const terminalId = nextTerminalId(current);
      if (focus) setActiveId(terminalId);
      setMetaById((meta) => ({ ...meta, [terminalId]: DEFAULT_META }));
      return [...current, terminalId];
    });
  }, []);

  const closePane = useCallback(
    (terminalId: string) => {
      void window.api.terminal.close({ threadId: thread.id, terminalId });
      setPanes((current) => {
        const next = current.filter((id) => id !== terminalId);
        const fallback = next.at(-1) ?? DEFAULT_TERMINAL_ID;
        setActiveId((active) => (active === terminalId ? fallback : active));
        return next.length > 0 ? next : [DEFAULT_TERMINAL_ID];
      });
      setMetaById((current) => {
        const next = { ...current };
        delete next[terminalId];
        if (Object.keys(next).length === 0) next[DEFAULT_TERMINAL_ID] = DEFAULT_META;
        return next;
      });
    },
    [thread.id],
  );

  const activeMeta = metaById[activeId] ?? DEFAULT_META;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTerminalEventTarget(e.target)) return;
      const command = commandForEvent(e, { terminalFocus: true, terminalOpen: true });
      if (command === "terminal.new") {
        e.preventDefault();
        e.stopPropagation();
        addPane(true);
        return;
      }
      if (command === "terminal.split") {
        e.preventDefault();
        e.stopPropagation();
        addPane(true);
        return;
      }
      if (command === "terminal.close") {
        e.preventDefault();
        e.stopPropagation();
        closePane(activeId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeId, addPane, closePane, commandForEvent]);

  const paneGridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${panes.length}, minmax(280px, 1fr))`,
    }),
    [panes.length],
  );

  const clearActive = async () => {
    await window.api.terminal.clear({ threadId: thread.id, terminalId: activeId });
  };

  const restartActive = async () => {
    const res = await window.api.terminal.restart({
      threadId: thread.id,
      terminalId: activeId,
      cwd,
      worktreePath: thread.worktreePath ?? null,
    });
    if (!res.ok) updateMeta(activeId, { status: "error", pid: null, error: res.error });
  };

  const attachActiveContext = () => {
    const capture = captureByIdRef.current[activeId];
    const selection = capture?.();
    if (selection) onAttachContext(selection);
  };

  const registerCapture = useCallback(
    (terminalId: string, capture: CaptureTerminalContext | null) => {
      if (capture) captureByIdRef.current[terminalId] = capture;
      else delete captureByIdRef.current[terminalId];
    },
    [],
  );

  return (
    <section
      aria-label="Terminal"
      data-terminal-root
      className="flex h-[34vh] min-h-[220px] max-h-[520px] shrink-0 flex-col border-t border-rule bg-ink text-surface shadow-[0_-12px_30px_rgba(28,26,20,0.08)]"
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[#39352a] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon size={13} />
          <span className="text-[12px] font-medium">Terminal</span>
          <span className="font-mono text-[10.5px] text-[#b6b0a3]">
            {activeMeta.status}
            {activeMeta.pid ? ` · pid ${activeMeta.pid}` : ""}
          </span>
          <span className="min-w-0 truncate font-mono text-[10.5px] text-[#8d877a]">
            {cwd}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {panes.map((terminalId) => (
            <button
              key={terminalId}
              type="button"
              onClick={() => setActiveId(terminalId)}
              className={`h-6 shrink-0 rounded-sm border px-2 font-mono text-[10.5px] transition-colors ${
                terminalId === activeId
                  ? "border-[#7a4716] bg-[#2b251b] text-[#f4f0e6]"
                  : "border-[#39352a] text-[#b6b0a3] hover:bg-[#252118] hover:text-[#faf7ef]"
              }`}
            >
              {terminalLabel(terminalId)}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Attach active terminal context" onClick={attachActiveContext}>
            <CopyIcon size={12} />
          </IconButton>
          <IconButton label="New terminal" onClick={() => addPane(true)}>
            <PlusIcon size={12} />
          </IconButton>
          <IconButton label="Split terminal" onClick={() => addPane(true)}>
            <TerminalIcon size={12} />
          </IconButton>
          <IconButton label="Clear active terminal" onClick={() => void clearActive()}>
            <TrashIcon size={12} />
          </IconButton>
          <IconButton label="Restart active terminal" onClick={() => void restartActive()}>
            <ResetIcon size={12} />
          </IconButton>
          <IconButton label="Close active terminal" onClick={() => closePane(activeId)}>
            <StopIcon size={12} />
          </IconButton>
          <IconButton label="Hide terminal" onClick={onHide}>
            <CloseIcon size={12} />
          </IconButton>
        </div>
      </header>
      {activeMeta.error && (
        <div className="shrink-0 border-b border-error/40 bg-error-soft px-3 py-1.5 text-[12px] text-error">
          {activeMeta.error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="grid h-full min-w-full" style={paneGridStyle}>
          {panes.map((terminalId, index) => (
            <TerminalPane
              key={`${thread.id}:${terminalId}`}
              thread={thread}
              terminalId={terminalId}
              cwd={cwd}
              active={terminalId === activeId}
              worktreePath={thread.worktreePath ?? null}
              withDivider={index > 0}
              onFocus={() => setActiveId(terminalId)}
              onMeta={(next) => updateMeta(terminalId, next)}
              onCaptureReady={registerCapture}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TerminalPane({
  thread,
  terminalId,
  cwd,
  worktreePath,
  active,
  withDivider,
  onFocus,
  onMeta,
  onCaptureReady,
}: {
  thread: Thread;
  terminalId: string;
  cwd: string;
  worktreePath: string | null;
  active: boolean;
  withDivider: boolean;
  onFocus: () => void;
  onMeta: (meta: Partial<PaneMeta>) => void;
  onCaptureReady: (terminalId: string, capture: CaptureTerminalContext | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wroteHistoryRef = useRef(false);
  const activeRef = useRef(active);
  const onMetaRef = useRef(onMeta);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    onMetaRef.current = onMeta;
  }, [onMeta]);

  useEffect(() => {
    const capture = (): TerminalContextSelection | null => {
      const term = termRef.current;
      if (!term) return null;
      const selectedText = term.getSelection();
      if (selectedText.trim().length > 0) {
        const position = term.getSelectionPosition();
        const lineStart = position ? Math.max(1, position.start.y) : 1;
        const lineEnd = position ? Math.max(lineStart, position.end.y) : lineStart;
        return {
          terminalId,
          terminalLabel: `Terminal ${terminalLabel(terminalId)}`,
          lineStart,
          lineEnd,
          text: selectedText,
        };
      }
      return captureLastTerminalLines(term, terminalId);
    };
    onCaptureReady(terminalId, capture);
    return () => onCaptureReady(terminalId, null);
  }, [onCaptureReady, terminalId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !cwd) return;

    let disposed = false;
    wroteHistoryRef.current = false;
    const term = new XTerm({
      allowProposedApi: false,
      cursorBlink: true,
      convertEol: false,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    termRef.current = term;
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(host);

    const fitAndResize = () => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      void window.api.terminal.resize({
        threadId: thread.id,
        terminalId,
        cols: term.cols,
        rows: term.rows,
      });
    };

    const offEvent = window.api.terminal.onEvent((event) => {
      if (event.threadId !== thread.id || event.terminalId !== terminalId) return;
      if (event.type === "output") {
        term.write(event.data);
        return;
      }
      if (event.type === "started" || event.type === "restarted") {
        onMetaRef.current({ status: event.snapshot.status, pid: event.snapshot.pid, error: null });
        if (event.type === "restarted") {
          term.reset();
          wroteHistoryRef.current = false;
        }
        return;
      }
      if (event.type === "exited") {
        onMetaRef.current({ status: "exited", pid: null });
        return;
      }
      if (event.type === "error") {
        onMetaRef.current({ status: "error", pid: null, error: event.message });
        return;
      }
      if (event.type === "cleared") {
        term.clear();
      }
    });

    const dataDisposable = term.onData((data) => {
      void window.api.terminal.write({ threadId: thread.id, terminalId, data });
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      void window.api.terminal.resize({ threadId: thread.id, terminalId, cols, rows });
    });
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);

    requestAnimationFrame(() => {
      fitAndResize();
      void window.api.terminal
        .open({
          threadId: thread.id,
          terminalId,
          cwd,
          worktreePath,
          cols: term.cols,
          rows: term.rows,
        })
        .then((res) => {
          if (disposed) return;
          if (!res.ok) {
            onMetaRef.current({ status: "error", pid: null, error: res.error });
            term.writeln(`\x1b[31m${res.error}\x1b[0m`);
            return;
          }
          if (res.snapshot) {
            onMetaRef.current({ status: res.snapshot.status, pid: res.snapshot.pid, error: null });
            if (res.snapshot.history && !wroteHistoryRef.current) {
              wroteHistoryRef.current = true;
              term.write(res.snapshot.history);
            }
          }
          if (activeRef.current) term.focus();
        });
    });

    return () => {
      disposed = true;
      observer.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      offEvent();
      term.dispose();
      if (termRef.current === term) termRef.current = null;
      if (fitRef.current === fit) fitRef.current = null;
    };
  }, [cwd, terminalId, thread.id, worktreePath]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return (
    <div
      ref={hostRef}
      data-terminal-pane
      data-terminal-id={terminalId}
      onMouseDown={onFocus}
      onFocus={onFocus}
      className={`min-h-0 overflow-hidden px-2 py-2 ${
        withDivider ? "border-l border-[#39352a]" : ""
      }`}
    />
  );
}

function terminalTheme() {
  return {
    background: "#1c1a14",
    foreground: "#f4f0e6",
    cursor: "#f0e1c4",
    selectionBackground: "#7a471666",
    black: "#1c1a14",
    red: "#d97757",
    green: "#a6c36f",
    yellow: "#d7a955",
    blue: "#8bb6d6",
    magenta: "#c08bd6",
    cyan: "#7fc4bd",
    white: "#f4f0e6",
    brightBlack: "#8d877a",
    brightRed: "#ef8a67",
    brightGreen: "#bed889",
    brightYellow: "#e3bc71",
    brightBlue: "#a3cae7",
    brightMagenta: "#d3a0e6",
    brightCyan: "#9bd8d2",
    brightWhite: "#faf7ef",
  };
}

function nextTerminalId(existing: string[]): string {
  for (let i = 2; i < 100; i++) {
    const id = `terminal-${i}`;
    if (!existing.includes(id)) return id;
  }
  return `terminal-${Date.now()}`;
}

function terminalLabel(terminalId: string): string {
  if (terminalId === DEFAULT_TERMINAL_ID) return "1";
  const n = terminalId.match(/\d+$/)?.[0];
  return n ?? terminalId;
}

export function isTerminalEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("[data-terminal-root]") !== null;
}

function captureLastTerminalLines(
  term: XTerm,
  terminalId: string,
): TerminalContextSelection | null {
  const buffer = term.buffer.active;
  const cursorLine = Math.min(buffer.length - 1, buffer.baseY + buffer.cursorY);
  const startLine = Math.max(0, cursorLine - 79);
  const lines: string[] = [];
  for (let line = startLine; line <= cursorLine; line += 1) {
    lines.push(buffer.getLine(line)?.translateToString(true) ?? "");
  }

  let first = 0;
  let last = lines.length - 1;
  while (first <= last && lines[first]!.trim().length === 0) first += 1;
  while (last >= first && lines[last]!.trim().length === 0) last -= 1;
  if (first > last) return null;

  return {
    terminalId,
    terminalLabel: `Terminal ${terminalLabel(terminalId)}`,
    lineStart: startLine + first + 1,
    lineEnd: startLine + last + 1,
    text: lines.slice(first, last + 1).join("\n"),
  };
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-sm text-[#b6b0a3] transition-colors hover:bg-[#39352a] hover:text-[#faf7ef]"
    >
      {children}
    </button>
  );
}

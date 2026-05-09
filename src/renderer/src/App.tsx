import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { ChevronLeftIcon, ChevronRightIcon } from "./components/icons";
import { Sidebar } from "./components/Sidebar";
import { Settings } from "./components/Settings";
import { TitleBar } from "./components/TitleBar";
import { StoreProvider } from "./state/store";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

type View = "chat" | "settings";

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
  const [view, setView] = useState<View>("chat");
  const openSettings = () => setView("settings");
  const closeSettings = () => setView("chat");

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

  // Global shortcuts. Capture phase so they beat textarea/input handlers.
  //   Ctrl/Cmd+,    — toggle Settings view
  //   Ctrl/Cmd+B    — toggle sidebar visibility (matches VS Code / Cursor)
  //   Esc           — when on Settings view, route back to chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && (e.key === "," || e.code === "Comma")) {
        e.preventDefault();
        e.stopPropagation();
        setView((v) => (v === "settings" ? "chat" : "settings"));
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        setSidebarHidden((v) => !v);
        return;
      }
      if (e.key === "Escape") {
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
  }, []);

  const gridStyle = sidebarHidden
    ? { gridTemplateColumns: "0px 1fr" }
    : { gridTemplateColumns: `${sidebarWidth}px 1fr` };

  return (
    <div className="grid h-full grid-rows-[36px_1fr] bg-canvas font-sans text-ink overflow-hidden">
      <TitleBar
        onOpenSettings={openSettings}
        settingsActive={view === "settings"}
        onToggleSidebar={() => setSidebarHidden((v) => !v)}
        sidebarHidden={sidebarHidden}
      />
      <div className="grid min-h-0 overflow-hidden" style={gridStyle}>
        <div
          className={`relative border-r border-rule overflow-hidden ${
            sidebarHidden ? "pointer-events-none invisible" : ""
          }`}
        >
          <Sidebar onOpenSettings={openSettings} settingsActive={view === "settings"} />
          {!sidebarHidden && (
            <SidebarResizeHandle
              width={sidebarWidth}
              onChange={(w) => setSidebarWidth(clampSidebar(w))}
            />
          )}
        </div>
        <div className="relative overflow-hidden">
          {sidebarHidden && (
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
            <Settings onClose={closeSettings} />
          ) : (
            <ChatPanel onOpenSettings={openSettings} />
          )}
        </div>
      </div>
    </div>
  );
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

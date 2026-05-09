import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export type ContextMenuItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  icon?: ReactNode;
  disabled?: boolean;
  divider?: never;
};

export type ContextMenuDivider = {
  key: string;
  divider: true;
};

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

type Props = {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
};

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Constrain to viewport
  const safe = constrain(x, y, 220);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: safe.x, top: safe.y }}
      className="fixed z-50 min-w-[200px] rounded-md border border-rule-strong bg-canvas py-1 shadow-md"
      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
    >
      {items.map((it) =>
        "divider" in it && it.divider ? (
          <div key={it.key} className="my-1 h-px bg-rule" />
        ) : (
          <button
            type="button"
            key={(it as ContextMenuItem).key}
            disabled={(it as ContextMenuItem).disabled}
            onClick={() => {
              if ((it as ContextMenuItem).disabled) return;
              (it as ContextMenuItem).onSelect();
              onClose();
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${
              (it as ContextMenuItem).tone === "danger"
                ? "text-error hover:bg-error-soft/60"
                : "text-ink hover:bg-surface"
            } ${(it as ContextMenuItem).disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {(it as ContextMenuItem).icon ? (
              <span className="flex h-4 w-4 items-center justify-center text-ink-3">
                {(it as ContextMenuItem).icon}
              </span>
            ) : (
              <span className="h-4 w-4" />
            )}
            <span className="flex-1">{(it as ContextMenuItem).label}</span>
          </button>
        ),
      )}
    </div>
  );
}

function constrain(x: number, y: number, width: number) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxH = 320;
  return {
    x: Math.max(8, Math.min(x, vw - width - 8)),
    y: Math.max(8, Math.min(y, vh - maxH - 8)),
  };
}

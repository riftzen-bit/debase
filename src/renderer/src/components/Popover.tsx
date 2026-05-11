import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Align = "start" | "end";
type Placement = "top" | "bottom" | "auto";

type Props = {
  trigger: (ctx: { open: boolean; toggle: () => void; close: () => void }) => ReactNode;
  children: (ctx: { close: () => void }) => ReactNode;
  align?: Align;
  width?: number | "auto";
  className?: string;
  /**
   * Where the panel opens relative to the trigger.
   * - "auto" (default): pick whichever side has more room. Falls back to "bottom" when there's enough space below.
   * - "top" / "bottom": forced direction.
   */
  placement?: Placement;
  /**
   * Minimum space (px) we want available on the preferred side before flipping.
   */
  minSpace?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Popover({
  trigger,
  children,
  align = "start",
  width = 220,
  className,
  placement = "auto",
  minSpace = 240,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (controlledOpen === undefined) setUncontrolledOpen(resolved);
    onOpenChange?.(resolved);
  };
  const [resolved, setResolved] = useState<"top" | "bottom">("bottom");
  const [resolvedAlign, setResolvedAlign] = useState<Align>(align);
  const [horizontalStyle, setHorizontalStyle] = useState<React.CSSProperties>(
    () => (typeof width === "number" ? { width } : {}),
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    if (placement === "auto") {
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      // Prefer below; flip up only if below is too small AND above has more room.
      setResolved(spaceBelow >= minSpace || spaceBelow >= spaceAbove ? "bottom" : "top");
    } else {
      setResolved(placement);
    }

    // Keep the popover inside the viewport. Flipping start/end is enough for
    // normal desktop menus; narrow captures need a clamped pixel offset.
    if (typeof width === "number") {
      const margin = 8;
      const panelWidth = Math.min(width, Math.max(160, window.innerWidth - margin * 2));
      const desiredLeft = align === "end" ? rect.right - panelWidth : rect.left;
      const maxLeft = Math.max(margin, window.innerWidth - margin - panelWidth);
      const clampedLeft = Math.min(Math.max(margin, desiredLeft), maxLeft);
      setHorizontalStyle({ left: clampedLeft - rect.left, width: panelWidth });

      const overflowRightWithStart = rect.left + panelWidth > window.innerWidth - margin;
      const overflowLeftWithEnd = rect.right - panelWidth < margin;
      if (align === "start" && overflowRightWithStart) {
        setResolvedAlign("end");
      } else if (align === "end" && overflowLeftWithEnd) {
        setResolvedAlign("start");
      } else {
        setResolvedAlign(align);
      }
    } else {
      setResolvedAlign(align);
      setHorizontalStyle({});
    }
  }, [open, placement, minSpace, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        // Stop the same Escape from also closing a parent (e.g. the Settings
        // drawer). We capture-phase listen so we beat the drawer's handler.
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const ctx = {
    open,
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false),
  };

  const positionStyle: React.CSSProperties =
    resolved === "top"
      ? { bottom: "100%", marginBottom: 4 }
      : { top: "100%", marginTop: 4 };

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trigger(ctx)}
      {open && (
        <div
          className={`absolute z-40 max-h-[60vh] overflow-auto rounded-md border border-rule-strong bg-canvas py-1 shadow-md ${
            typeof width === "number" ? "" : resolvedAlign === "end" ? "right-0" : "left-0"
          } ${className ?? ""}`}
          style={{
            ...(width === "auto" ? {} : horizontalStyle),
            ...positionStyle,
          }}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  active,
  onClick,
  disabled,
  hint,
  icon,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left text-[12.5px] leading-tight transition-colors ${
        active ? "bg-accent-soft/60 text-accent-deep" : "text-ink hover:bg-surface"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {icon ? (
        <span
          className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center ${
            active ? "text-accent-deep" : "text-ink-3"
          }`}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 min-w-0">
        <span className="block">{children}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-ink-3">{hint}</span> : null}
      </span>
      {active ? (
        <span className="mt-[5px] inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[11px] italic text-ink-3">
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-rule" />;
}

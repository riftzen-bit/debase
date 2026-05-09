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
};

export function Popover({
  trigger,
  children,
  align = "start",
  width = 220,
  className,
  placement = "auto",
  minSpace = 240,
}: Props) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<"top" | "bottom">("bottom");
  const [resolvedAlign, setResolvedAlign] = useState<Align>(align);
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

    // Alignment auto-flip: keep the popover inside the viewport by switching
    // to the opposite side when the requested align would overflow.
    if (typeof width === "number") {
      const margin = 8;
      const overflowRightWithStart = rect.left + width > window.innerWidth - margin;
      const overflowLeftWithEnd = rect.right - width < margin;
      if (align === "start" && overflowRightWithStart) {
        setResolvedAlign("end");
      } else if (align === "end" && overflowLeftWithEnd) {
        setResolvedAlign("start");
      } else {
        setResolvedAlign(align);
      }
    } else {
      setResolvedAlign(align);
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
            resolvedAlign === "end" ? "right-0" : "left-0"
          } ${className ?? ""}`}
          style={{ width: width === "auto" ? undefined : width, ...positionStyle }}
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

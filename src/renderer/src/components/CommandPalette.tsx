import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatKeys } from "../lib/shortcuts";
import { SearchIcon } from "./icons";

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  keys?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
};

export function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => filterActions(actions, query), [actions, query]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  useEffect(() => {
    if (!open) return;
    const child = listRef.current?.children[active] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item && !item.disabled) {
        item.onSelect();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-ink/20"
        onMouseDown={onClose}
      />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-rule-strong bg-canvas shadow-md">
        <div className="flex items-center gap-2 border-b border-rule px-3 py-2.5">
          <span className="text-ink-3">
            <SearchIcon size={14} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Run a command…"
            className="flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-3 focus:outline-none"
            spellCheck={false}
          />
          <span className="font-mono text-[10.5px] text-ink-3">esc</span>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-ink-3">
              No matching commands.
            </div>
          ) : (
            filtered.map((action, i) => (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  if (action.disabled) return;
                  action.onSelect();
                  onClose();
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  i === active ? "bg-surface" : "hover:bg-surface/60"
                } ${action.disabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-3">
                  {action.icon ?? <SearchIcon size={12} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{action.label}</span>
                  {action.hint && (
                    <span className="block truncate text-[11.5px] text-ink-3">{action.hint}</span>
                  )}
                </span>
                {action.keys && (
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
                    {formatKeys(action.keys)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function filterActions(actions: PaletteAction[], q: string): PaletteAction[] {
  const query = q.trim().toLowerCase();
  if (!query) return actions;
  const tokens = query.split(/\s+/);
  return actions
    .map((a) => {
      const hay = `${a.label} ${a.hint ?? ""}`.toLowerCase();
      const score = tokens.every((t) => hay.includes(t)) ? hay.length - query.length : -1;
      return { a, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.a);
}

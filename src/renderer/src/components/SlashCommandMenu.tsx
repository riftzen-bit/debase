import { useEffect, useRef, type ReactNode } from "react";

export type SlashCommand = {
  id: string;
  trigger: string;
  description: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  run: () => void;
};

type Props = {
  open: boolean;
  query: string;
  commands: SlashCommand[];
  active: number;
  onActiveChange: (next: number) => void;
  onSelect: (cmd: SlashCommand) => void;
};

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.trigger.toLowerCase().includes(q));
}

export function SlashCommandMenu({
  open,
  query,
  commands,
  active,
  onActiveChange,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const child = listRef.current?.children[active] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open || commands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-30">
      <div className="overflow-hidden rounded-md border border-rule-strong bg-canvas shadow-md">
        <div className="border-b border-rule px-3 py-1.5 font-mono text-[11px] italic text-ink-3">
          slash command{query && <span className="ml-1.5 not-italic text-ink-2">{query}</span>}
        </div>
        <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
          {commands.map((cmd, i) => {
            const isActive = i === active;
            return (
              <button
                key={cmd.id}
                type="button"
                disabled={cmd.disabled}
                onMouseEnter={() => onActiveChange(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (cmd.disabled) return;
                  onSelect(cmd);
                }}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors ${
                  isActive ? "bg-surface" : "hover:bg-surface/60"
                } ${cmd.disabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                {cmd.icon && (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-3">
                    {cmd.icon}
                  </span>
                )}
                <span className="font-mono text-[12.5px] text-accent-deep shrink-0">
                  {cmd.trigger}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                  {cmd.description}
                </span>
                {cmd.hint && (
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{cmd.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { Platform } from "@shared/chat";
import { BarsIcon, BrandMark, GearIcon } from "./icons";

type Props = {
  onOpenSettings: () => void;
  settingsActive?: boolean;
  onToggleSidebar?: () => void;
  sidebarHidden?: boolean;
};

export function TitleBar({
  onOpenSettings,
  settingsActive,
  onToggleSidebar,
  sidebarHidden,
}: Props) {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    let mounted = true;
    window.api.env.get().then((env) => {
      if (mounted) setPlatform(env.platform);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const isMac = platform === "darwin";

  return (
    <header
      className={`drag-region flex h-9 items-center justify-between border-b border-rule bg-canvas ${
        isMac ? "pl-20 pr-3" : "pl-3 pr-36"
      }`}
    >
      <div className="flex items-center gap-2 text-ink">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarHidden ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!sidebarHidden}
            className={`no-drag flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${
              !sidebarHidden
                ? "text-ink-2 hover:bg-surface hover:text-ink"
                : "text-ink-3 hover:bg-surface hover:text-ink-2"
            }`}
          >
            <BarsIcon size={13} />
          </button>
        )}
        <span className="text-accent">
          <BrandMark size={14} />
        </span>
        <span className="text-[12.5px] font-medium tracking-tight">debase</span>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
        aria-pressed={settingsActive}
        className={`no-drag flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${
          settingsActive
            ? "bg-surface text-ink"
            : "text-ink-3 hover:bg-surface hover:text-ink-2"
        }`}
      >
        <GearIcon size={13} />
      </button>
    </header>
  );
}

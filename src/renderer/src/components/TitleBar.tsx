import { useEffect, useState, type ReactNode } from "react";
import type { Platform } from "@shared/chat";
import { BarsIcon, BrandMark, CloseIcon, FullscreenIcon, GearIcon, MinusIcon } from "./icons";

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
  const [maximized, setMaximized] = useState(false);

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
  const isLinux = platform === "linux";

  useEffect(() => {
    if (!isLinux) return;
    let mounted = true;
    void window.api.window.isMaximized().then((value) => {
      if (mounted) setMaximized(value);
    });
    const unsubscribe = window.api.window.onMaximizeChange((value) => {
      setMaximized(value);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [isLinux]);

  return (
    <header
      className={`drag-region flex h-9 items-center justify-between border-b border-rule bg-canvas ${
        isMac ? "pl-20 pr-3" : isLinux ? "pl-3 pr-2" : "pl-3 pr-36"
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
      <div className="flex items-center gap-1">
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
        {isLinux && (
          <div className="no-drag ml-1 flex items-center overflow-hidden rounded-sm border border-rule bg-surface/50">
            <WindowButton label="Minimize" onClick={() => void window.api.window.minimize()}>
              <MinusIcon size={12} />
            </WindowButton>
            <WindowButton
              label={maximized ? "Restore" : "Maximize"}
              onClick={() => void window.api.window.maximize()}
            >
              <FullscreenIcon size={12} />
            </WindowButton>
            <WindowButton
              label="Close"
              tone="danger"
              onClick={() => void window.api.window.close()}
            >
              <CloseIcon size={12} />
            </WindowButton>
          </div>
        )}
      </div>
    </header>
  );
}

function WindowButton({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  tone?: "danger";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-8 items-center justify-center border-l border-rule first:border-l-0 transition-colors ${
        tone === "danger"
          ? "text-ink-3 hover:bg-error-soft hover:text-error"
          : "text-ink-3 hover:bg-canvas hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}

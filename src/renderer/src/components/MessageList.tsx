import { useCallback, useEffect, useRef, useState } from "react";
import type { Thread } from "../state/types";
import { Message } from "./Message";
import { ChevronDownIcon } from "./icons";

type Props = {
  thread: Thread;
  /**
   * Owned by ChatPanel. When true, the list snaps to the bottom on every
   * messages change and on intra-message growth (streaming text appended to
   * the active assistant turn). When false, the classic "stick to bottom
   * if you were already there" rule applies.
   */
  locked: boolean;
  cwd?: string;
};

const NEAR_BOTTOM_PX = 240;

export function MessageList({ thread, locked, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(thread.messages.length);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX ||
      lastCountRef.current === 0;
    if (locked || isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    }
    lastCountRef.current = thread.messages.length;
  }, [thread.messages, locked]);

  // While locked, watch for content height growth inside the message column
  // — streaming chunks mutate the active assistant message's blocks without
  // changing the messages array reference, so the effect above wouldn't fire.
  useEffect(() => {
    if (!locked) return;
    const el = containerRef.current;
    if (!el) return;
    const child = el.firstElementChild as HTMLElement | null;
    if (!child) return;
    const obs = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    obs.observe(child);
    return () => obs.disconnect();
  }, [locked, thread.id]);

  // Engaging the lock should jump the user immediately, even if they were
  // scrolled up. (Releasing leaves them where they are.)
  useEffect(() => {
    if (locked) scrollToBottom(true);
  }, [locked, scrollToBottom]);

  // Reset scroll bookkeeping when switching threads.
  useEffect(() => {
    setAtBottom(true);
    lastCountRef.current = 0;
  }, [thread.id]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < NEAR_BOTTOM_PX);
  }, []);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden"
      >
        <div className="mx-auto max-w-3xl">
          {thread.messages.map((msg) => (
            <Message
              key={msg.id}
              message={msg}
              threadId={thread.id}
              cwd={cwd}
              providerFallback={thread.runConfig.provider}
            />
          ))}
        </div>
      </div>

      {/* Scroll-to-bottom is the only floating affordance now — transient,
        only shown when the user is more than NEAR_BOTTOM_PX above the latest
        turn. The lock toggle moved into the composer so it never overlaps
        chat content. */}
      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-rule-strong bg-canvas/95 px-3 py-1.5 text-[12px] text-ink-2 shadow-md shadow-ink/5 transition-colors hover:bg-surface hover:text-ink"
          >
            <ChevronDownIcon size={12} />
            <span>Scroll to bottom</span>
          </button>
        </div>
      )}
    </div>
  );
}

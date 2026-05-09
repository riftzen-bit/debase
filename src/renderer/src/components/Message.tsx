import { useEffect, useState } from "react";
import type { AssistantBlock, AssistantMessage, ChatMessage } from "../state/types";
import { Markdown } from "./Markdown";
import { Trace } from "./Trace";
import { formatCost, formatDuration } from "../lib/format";
import { CheckIcon, CopyIcon } from "./icons";

type Props = {
  message: ChatMessage;
};

export function Message({ message }: Props) {
  if (message.role === "user") {
    return (
      <article className="grid grid-cols-[72px_1fr] gap-4 border-b border-rule/60 px-6 py-5">
        <RoleLabel role="You" />
        <div className="font-sans text-[14.5px] leading-relaxed text-ink whitespace-pre-wrap break-words">
          {message.text}
        </div>
      </article>
    );
  }

  const isStreaming = message.status === "streaming";
  const grouped = groupBlocks(message.blocks);
  const copyable = extractText(message);

  const showFooter =
    !isStreaming &&
    (copyable.length > 0 ||
      message.status === "done" ||
      message.status === "error");

  return (
    <article className="grid grid-cols-[72px_1fr] gap-4 border-b border-rule/60 px-6 py-5">
      <RoleLabel role="Claude" tone="accent" />
      <div className="min-w-0 space-y-2">
        {grouped.length === 0 && isStreaming && <WorkingIndicator startedAt={message.createdAt} />}

        {grouped.map((seg, i) =>
          seg.kind === "text" ? (
            <div key={`t-${i}`}>
              <Markdown>{seg.text}</Markdown>
            </div>
          ) : (
            <Trace
              key={`g-${i}`}
              ops={seg.ops}
              streaming={isStreaming && i === grouped.length - 1}
              parentDone={!isStreaming}
            />
          ),
        )}

        {isStreaming && grouped.length > 0 && (
          <WorkingIndicator startedAt={message.createdAt} />
        )}

        {message.status === "error" && (
          <div className="mt-2 rounded-md border border-error/40 bg-error-soft/60 px-3 py-2 text-[13px] text-error">
            {message.errorText ?? "An error occurred."}
          </div>
        )}

        {showFooter && (
          <footer className="mt-3 flex flex-wrap items-center gap-3 text-[11.5px] text-ink-3">
            {copyable.length > 0 && <CopyAction text={copyable} />}
            {message.status === "done" &&
              (message.costUsd != null || message.turns != null) && (
                <>
                  <span className="h-3 w-px bg-rule" />
                  {message.turns != null && (
                    <span>
                      {message.turns} turn{message.turns === 1 ? "" : "s"}
                    </span>
                  )}
                  {message.durationMs != null && (
                    <span>{formatDuration(message.durationMs)}</span>
                  )}
                  <span>{formatCost(message.costUsd)}</span>
                </>
              )}
          </footer>
        )}
      </div>
    </article>
  );
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "ops"; ops: Exclude<AssistantBlock, { kind: "text" }>[] };

function groupBlocks(blocks: AssistantBlock[]): Segment[] {
  const out: Segment[] = [];
  for (const b of blocks) {
    if (b.kind === "text") {
      out.push({ kind: "text", text: b.text });
      continue;
    }
    const tail = out[out.length - 1];
    if (tail && tail.kind === "ops") {
      tail.ops.push(b);
    } else {
      out.push({ kind: "ops", ops: [b] });
    }
  }
  return out;
}

function extractText(msg: AssistantMessage): string {
  return msg.blocks
    .filter((b): b is Extract<AssistantBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // ignore — clipboard may be unavailable in some embedded contexts
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? "Copied" : "Copy response"}
      aria-label={copied ? "Response copied" : "Copy response"}
      className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors duration-200 ${
        copied
          ? "border-accent/60 bg-accent-soft/70 text-accent-deep"
          : "border-rule bg-canvas text-ink-2 hover:border-rule-strong hover:bg-surface hover:text-ink"
      }`}
    >
      {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
      <span className="font-mono">{copied ? "copied" : "copy"}</span>
    </button>
  );
}

function WorkingIndicator({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="mt-1 inline-flex items-center gap-2 text-[11.5px] text-ink-3">
      <span className="inline-flex items-center gap-1">
        <span className="dot-cycle h-1.5 w-1.5 rounded-full" />
        <span className="dot-cycle h-1.5 w-1.5 rounded-full [animation-delay:300ms]" />
        <span className="dot-cycle h-1.5 w-1.5 rounded-full [animation-delay:600ms]" />
      </span>
      <span className="font-mono">working · {fmtElapsed(elapsed)}</span>
    </div>
  );
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function RoleLabel({ role, tone }: { role: string; tone?: "accent" }) {
  return (
    <div className="pt-0.5">
      <div
        className={`text-[12.5px] font-medium ${tone === "accent" ? "text-accent-deep" : "text-ink-2"}`}
      >
        {role}
      </div>
    </div>
  );
}

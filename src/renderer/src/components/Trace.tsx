import { useState, type ReactNode } from "react";
import type { ProviderId } from "@shared/providers";
import type { AssistantBlock } from "../state/types";
import { useStore } from "../state/store";
import { truncate } from "../lib/format";
import { AgentIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, SparkleIcon } from "./icons";
import { tryRenderDiff } from "./DiffView";

type OpBlock = Exclude<AssistantBlock, { kind: "text" | "user_input" }>;
type ToolUseBlock = Extract<AssistantBlock, { kind: "tool_use" }>;

type Props = {
  ops: OpBlock[];
  /** When true, the most recent op is implicitly "live" — its dot pulses. */
  streaming?: boolean;
  /**
   * True when the parent assistant turn has finished (status !== "streaming").
   * Without it, a tool_use that never received its tool_result (e.g. on
   * cancel) stays "running" forever; with it, those orphans flip to
   * "aborted" so the trace tells the truth.
   */
  parentDone?: boolean;
  provider?: ProviderId;
};

type OpStatus = "running" | "done" | "error" | "aborted";

const DEFAULT_VISIBLE = 5;

/**
 * "Trace" — a grouped record of tool calls + thinking blocks for one assistant
 * turn. Editorial framing: a hairline left rail joins the rows, the count is
 * a small italic label, and rows are click-to-expand details rather than the
 * card-in-card pattern. When ops > DEFAULT_VISIBLE the older ones fold
 * behind a "show N earlier" link. Task-tool ops render specially as an
 * "Agent · {description}" block so sub-agent dispatches are legible at a
 * glance, including how many ran in parallel and which type each was.
 */
export function Trace({ ops, streaming, parentDone, provider = "claude" }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (ops.length === 0) return null;

  const collapse = !expanded && ops.length > DEFAULT_VISIBLE;
  const hidden = collapse ? ops.length - DEFAULT_VISIBLE : 0;
  const visible = collapse ? ops.slice(hidden) : ops;
  const lastIndex = ops.length - 1;

  // Surface error / aborted counts in the header so the user can see at a
  // glance whether the agent's tool calls are mostly succeeding or mostly
  // failing — without expanding every row.
  const counts = countStatuses(ops, parentDone === true, streaming === true, lastIndex);
  const agentCount = ops.filter(
    (o) => o.kind === "tool_use" && o.name === "Task",
  ).length;

  return (
    <section className="my-3 overflow-hidden rounded-md border border-rule bg-surface/30">
      <header className="flex items-center justify-between gap-3 px-3 py-1.5">
        <span className="font-mono text-[11px] italic text-ink-3">
          trace
          <span className="ml-1.5 not-italic text-ink-2">{ops.length}</span>
          {agentCount > 0 && (
            <span className="ml-2 not-italic text-ink-3">
              · {agentCount} agent{agentCount === 1 ? "" : "s"}
            </span>
          )}
          {counts.errors > 0 && (
            <span className="ml-2 not-italic text-error">
              · {counts.errors} error{counts.errors === 1 ? "" : "s"}
            </span>
          )}
          {counts.aborted > 0 && (
            <span className="ml-2 not-italic text-ink-3">
              · {counts.aborted} aborted
            </span>
          )}
        </span>
        {ops.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[11px] italic text-ink-3 transition-colors hover:text-ink"
          >
            {expanded ? "show less" : `+ ${hidden} earlier`}
          </button>
        )}
      </header>
      <ul className="divide-y divide-rule/60 border-t border-rule/60">
        {visible.map((op, vi) => {
          const realIndex = collapse ? hidden + vi : vi;
          const isLast = realIndex === lastIndex;
          const live = streaming === true && isLast;
          if (op.kind === "tool_use" && op.name === "Task") {
            return (
              <li key={`agent-${realIndex}`}>
                <AgentRow op={op} live={live} parentDone={parentDone === true} />
              </li>
            );
          }
          return (
            <li key={`${op.kind}-${realIndex}`}>
              <OpRow
                op={op}
                live={live}
                parentDone={parentDone === true}
                provider={provider}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function countStatuses(
  ops: OpBlock[],
  parentDone: boolean,
  streaming: boolean,
  lastIndex: number,
): { errors: number; aborted: number } {
  let errors = 0;
  let aborted = 0;
  ops.forEach((op, i) => {
    if (op.kind !== "tool_use") return;
    if (op.result) {
      if (op.result.isError) errors += 1;
      return;
    }
    const live = streaming && i === lastIndex;
    if (!live && parentDone) aborted += 1;
  });
  return { errors, aborted };
}

function AgentRow({
  op,
  live,
  parentDone,
}: {
  op: ToolUseBlock;
  live: boolean;
  parentDone: boolean;
}) {
  const [open, setOpen] = useState(false);
  const input = (op.input ?? {}) as {
    description?: unknown;
    prompt?: unknown;
    subagent_type?: unknown;
  };
  const description = typeof input.description === "string" ? input.description : "Agent";
  const subagentType =
    typeof input.subagent_type === "string" ? input.subagent_type : null;
  const prompt = typeof input.prompt === "string" ? input.prompt : null;
  const result = op.result;
  const status = deriveStatus(result, live, parentDone);
  const dotClass = statusDotClass(status, live);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-surface/60"
      >
        <span className="text-ink-3">
          {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        </span>
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="text-accent-deep">
          <AgentIcon size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
          {description}
        </span>
        {subagentType && (
          <span className="hidden shrink-0 rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] text-ink-3 sm:inline-block">
            {subagentType}
          </span>
        )}
        <span className={`shrink-0 font-mono text-[11px] italic ${statusTextClass(status)}`}>
          {statusLabel(status)}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-rule/60 bg-canvas/60 px-4 py-3">
          {prompt && (
            <Section label="task">
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm border border-rule/60 bg-canvas px-3 py-2 font-sans text-[12.5px] leading-relaxed text-ink-2">
                {prompt}
              </pre>
            </Section>
          )}
          {result && (
            <Section label={result.isError ? "error" : "response"}>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap rounded-sm border border-rule/60 bg-canvas px-3 py-2 font-sans text-[12.5px] leading-relaxed ${
                  result.isError ? "text-error" : "text-ink"
                }`}
              >
                {truncate(result.output, 6000)}
              </pre>
            </Section>
          )}
          {!result && status === "aborted" && (
            <p className="text-[12px] italic text-ink-3">
              The agent was cancelled before this sub-agent could return a result.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OpRow({
  op,
  live,
  parentDone,
  provider,
}: {
  op: OpBlock;
  live: boolean;
  parentDone: boolean;
  provider: ProviderId;
}) {
  const [open, setOpen] = useState(false);
  const { state, respondToPermission } = useStore();
  const permission =
    op.kind === "tool_use"
      ? Object.values(state.pendingPermissions).find((p) => p.toolUseId === op.id) ?? null
      : null;

  if (op.kind === "thinking") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-surface/60"
        >
          <span className="text-ink-3">
            {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          </span>
          <span className="text-ink-3">
            <SparkleIcon size={11} />
          </span>
          <span className="font-mono text-[12px] text-ink-2">thinking</span>
          <span className="ml-auto font-mono text-[10.5px] text-ink-3">
            {op.text.length.toLocaleString()} chars
          </span>
        </button>
        {open && (
          <div className="border-t border-rule/60 bg-canvas/60 px-4 py-3 font-sans text-[12.5px] leading-relaxed text-ink-2 whitespace-pre-wrap">
            {op.text || "(empty)"}
          </div>
        )}
      </div>
    );
  }

  // tool_use
  const result = op.result;
  const status = deriveStatus(result, live, parentDone);
  const summary = inputSummary(op.name, op.input);
  const dotClass = statusDotClass(status, live);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-surface/60"
      >
        <span className="text-ink-3">
          {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        </span>
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="font-mono text-[12px] text-accent-deep">{op.name}</span>
        {summary && (
          <span className="truncate font-mono text-[12px] text-ink-3">{summary}</span>
        )}
        <span className={`ml-auto font-mono text-[11px] italic ${statusTextClass(status)}`}>
          {permission && permission.decision == null ? "awaiting approval" : statusLabel(status)}
        </span>
      </button>
      {permission && (
        <ApprovalRow
          provider={provider}
          permission={permission}
          onAllow={() => void respondToPermission(permission.permId, "allow")}
          onDeny={() => void respondToPermission(permission.permId, "deny")}
        />
      )}
      {open && (
        <div className="space-y-3 border-t border-rule/60 bg-canvas/60 px-4 py-3">
          {(() => {
            const diff = tryRenderDiff(op.name, op.input);
            return diff ? (
              <Section label="diff">{diff}</Section>
            ) : (
              <Section label="input">
                <pre className="overflow-x-auto rounded-sm border border-rule/60 bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed text-ink">
                  {safeStringify(op.input)}
                </pre>
              </Section>
            );
          })()}
          {result && (
            <Section label={result.isError ? "error" : "output"}>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap rounded-sm border border-rule/60 bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed ${
                  result.isError ? "text-error" : "text-ink"
                }`}
              >
                {truncate(result.output, 4000)}
              </pre>
            </Section>
          )}
          {!result && status === "aborted" && (
            <p className="text-[12px] italic text-ink-3">
              No tool result arrived — the run was cancelled or interrupted before this tool
              finished.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalRow({
  provider,
  permission,
  onAllow,
  onDeny,
}: {
  provider: ProviderId;
  permission: { permId: string; toolName: string; decision?: "allow" | "deny" };
  onAllow: () => void;
  onDeny: () => void;
}) {
  const decided = permission.decision != null;
  return (
    <div className="flex items-center gap-2 border-t border-rule/60 bg-accent-soft/20 px-4 py-2">
      <span className="font-mono text-[11px] italic text-accent-deep">
        approval needed
      </span>
      <span className="text-[11.5px] text-ink-2">
        Allow {roleForProvider(provider)} to run{" "}
        <span className="font-mono">{permission.toolName}</span>?
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {decided ? (
          <span
            className={`inline-flex h-6 items-center gap-1 rounded-md px-2 font-mono text-[11px] ${
              permission.decision === "allow"
                ? "bg-accent-soft/70 text-accent-deep"
                : "bg-error-soft/70 text-error"
            }`}
          >
            {permission.decision === "allow" ? <CheckIcon size={10} /> : <CloseIcon size={10} />}
            {permission.decision === "allow" ? "allowed" : "denied"}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onDeny}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-rule bg-canvas px-2 text-[11px] text-ink-2 transition-colors hover:border-error/60 hover:bg-error-soft/40 hover:text-error"
            >
              <CloseIcon size={10} />
              Deny
            </button>
            <button
              type="button"
              onClick={onAllow}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-accent/50 bg-accent-soft/60 px-2 text-[11px] text-accent-deep transition-colors hover:border-accent/80 hover:bg-accent-soft"
            >
              <CheckIcon size={10} />
              Allow
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function roleForProvider(provider: ProviderId): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case "claude":
    default:
      return "Claude";
  }
}

function deriveStatus(
  result: ToolUseBlock["result"],
  live: boolean,
  parentDone: boolean,
): OpStatus {
  if (result) return result.isError ? "error" : "done";
  if (live) return "running";
  if (parentDone) return "aborted";
  return "running";
}

function statusDotClass(status: OpStatus, live: boolean): string {
  if (status === "error") return "bg-error";
  if (status === "aborted") return "bg-ink-4";
  if (status === "running" || live) return "dot-cycle";
  return "bg-ink-4";
}

function statusTextClass(status: OpStatus): string {
  if (status === "error") return "text-error";
  if (status === "running") return "text-accent";
  if (status === "aborted") return "text-ink-3";
  return "text-ink-3";
}

function statusLabel(status: OpStatus): string {
  if (status === "error") return "error";
  if (status === "running") return "running";
  if (status === "aborted") return "aborted";
  return "ok";
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[11px] italic text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function inputSummary(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const lower = name.toLowerCase();
  const candidates: string[] = [];
  if (lower === "bash") candidates.push("command");
  if (lower === "read" || lower === "write" || lower === "edit") {
    candidates.push("file_path", "path");
  }
  if (lower === "grep" || lower === "glob") candidates.push("pattern");
  candidates.push("path", "url", "query", "command");
  for (const key of candidates) {
    const v = obj[key];
    if (typeof v === "string") return truncate(v, 80);
  }
  return "";
}

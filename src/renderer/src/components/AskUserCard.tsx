import { useState } from "react";
import type { AssistantBlock } from "../state/types";
import { useStore } from "../state/store";
import { CheckIcon, SparkleIcon } from "./icons";

type ToolUseBlock = Extract<AssistantBlock, { kind: "tool_use" }>;

type Question = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

type ParsedInput = { questions: Question[] } | null;

export function isAskUserBlock(block: AssistantBlock): block is ToolUseBlock {
  return block.kind === "tool_use" && block.name === "AskUserQuestion";
}

type Props = {
  block: ToolUseBlock;
  threadId: string;
};

export function AskUserCard({ block, threadId }: Props) {
  const parsed = parseInput(block.input);
  const { enqueuePrompt, sendPrompt, state } = useStore();
  const [picked, setPicked] = useState<string | null>(null);

  if (!parsed || parsed.questions.length === 0) {
    return null;
  }

  const isPending = state.pendings[threadId] != null;
  const alreadyAnswered = block.result != null;

  const onPick = (label: string, description?: string) => {
    if (alreadyAnswered || picked) return;
    const text = description ? `${label} — ${description}` : label;
    setPicked(label);
    if (isPending) {
      enqueuePrompt(text, threadId);
    } else {
      void sendPrompt(text, threadId);
    }
  };

  return (
    <section className="my-3 overflow-hidden rounded-lg border border-accent/40 bg-accent-soft/30">
      <header className="flex items-center gap-2 border-b border-accent/30 px-3 py-1.5">
        <span className="text-accent-deep">
          <SparkleIcon size={11} />
        </span>
        <span className="font-mono text-[11px] italic text-accent-deep">
          claude is asking
        </span>
        {alreadyAnswered && (
          <span className="ml-auto font-mono text-[10.5px] text-ink-3">
            auto-cancelled
          </span>
        )}
      </header>
      <div className="space-y-3 px-3 py-3">
        {parsed.questions.map((q, qi) => (
          <QuestionBlock
            key={qi}
            question={q}
            picked={picked}
            disabled={alreadyAnswered}
            onPick={onPick}
          />
        ))}
        {alreadyAnswered ? (
          // The SDK's built-in AskUserQuestion auto-cancels in non-CLI hosts
          // (see `src/main/agent/claude.ts` — we now disallow the tool, but
          // older threads may have these blocks persisted). Surface that
          // honestly so the user doesn't think the card is interactive.
          <p className="pt-1 text-[11.5px] italic text-ink-3">
            This question was auto-cancelled by the SDK — Claude will follow up in plain text
            below. Reply normally in the composer.
          </p>
        ) : (
          <p className="pt-1 text-[11.5px] italic text-ink-3">
            Pick an option (queues as your next message), or type a custom answer below.
          </p>
        )}
      </div>
    </section>
  );
}

function QuestionBlock({
  question,
  picked,
  disabled,
  onPick,
}: {
  question: Question;
  picked: string | null;
  disabled: boolean;
  onPick: (label: string, description?: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        {question.header && (
          <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] text-ink-3">
            {question.header}
          </span>
        )}
        <p className="text-[13.5px] leading-snug text-ink">{question.question}</p>
      </div>
      <ul className="space-y-1">
        {question.options.map((opt, oi) => {
          const isPicked = picked === opt.label;
          return (
            <li key={oi}>
              <button
                type="button"
                disabled={disabled || (picked !== null && !isPicked)}
                onClick={() => onPick(opt.label, opt.description)}
                className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
                  isPicked
                    ? "border-accent/60 bg-accent-soft/70 text-accent-deep"
                    : "border-rule bg-canvas text-ink hover:border-rule-strong hover:bg-surface"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span
                  className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    isPicked ? "border-accent bg-accent text-canvas" : "border-rule-strong"
                  }`}
                >
                  {isPicked && <CheckIcon size={9} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="mt-0.5 block text-[12px] text-ink-2">{opt.description}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function parseInput(raw: unknown): ParsedInput {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { questions?: unknown };
  if (!Array.isArray(obj.questions)) return null;
  const questions: Question[] = [];
  for (const q of obj.questions) {
    if (!q || typeof q !== "object") continue;
    const qq = q as Record<string, unknown>;
    if (typeof qq.question !== "string" || !Array.isArray(qq.options)) continue;
    const options: Question["options"] = [];
    for (const opt of qq.options) {
      if (!opt || typeof opt !== "object") continue;
      const oo = opt as Record<string, unknown>;
      if (typeof oo.label !== "string") continue;
      options.push({
        label: oo.label,
        description: typeof oo.description === "string" ? oo.description : undefined,
      });
    }
    if (options.length === 0) continue;
    questions.push({
      question: qq.question,
      header: typeof qq.header === "string" ? qq.header : undefined,
      multiSelect: qq.multiSelect === true,
      options,
    });
  }
  if (questions.length === 0) return null;
  return { questions };
}

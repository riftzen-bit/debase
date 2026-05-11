import { useMemo, useState } from "react";
import type { AssistantBlock } from "../state/types";
import { useStore } from "../state/store";
import { CheckIcon, CloseIcon, SparkleIcon } from "./icons";

type UserInputBlock = Extract<AssistantBlock, { kind: "user_input" }>;

type Props = {
  block: UserInputBlock;
};

export function UserInputCard({ block }: Props) {
  const { respondToUserInput } = useStore();
  const initialAnswers = useMemo(() => seedAnswers(block), [block]);
  const [answers, setAnswers] = useState<Record<string, string[]>>(initialAnswers);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const resolved = block.answers != null || block.rejected === true;

  const submit = async (reject = false) => {
    if (resolved || submitting) return;
    setSubmitting(true);
    try {
      await respondToUserInput(
        block.requestId,
        reject ? {} : mergeCustomAnswers(answers, custom),
        reject,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="my-3 overflow-hidden rounded-lg border border-accent/40 bg-accent-soft/30">
      <header className="flex items-center gap-2 border-b border-accent/30 px-3 py-1.5">
        <span className="text-accent-deep">
          <SparkleIcon size={11} />
        </span>
        <span className="font-mono text-[11px] italic text-accent-deep">
          OpenCode is asking
        </span>
        {resolved && (
          <span className="ml-auto font-mono text-[10.5px] text-ink-3">
            {block.rejected ? "skipped" : "answered"}
          </span>
        )}
      </header>
      <div className="space-y-3 px-3 py-3">
        {block.questions.map((question) => (
          <div key={question.id}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="rounded-sm border border-rule px-1.5 py-px font-mono text-[10.5px] text-ink-3">
                {question.header}
              </span>
              <p className="text-[13.5px] leading-snug text-ink">{question.question}</p>
            </div>
            <div className="space-y-1">
              {question.options.map((option) => {
                const picked = (answers[question.id] ?? []).includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={resolved || submitting}
                    onClick={() =>
                      setAnswers((current) =>
                        toggleAnswer(current, question.id, option.label, question.multiSelect),
                      )
                    }
                    className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
                      picked
                        ? "border-accent/60 bg-accent-soft/70 text-accent-deep"
                        : "border-rule bg-canvas text-ink hover:border-rule-strong hover:bg-surface"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <span
                      className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                        picked ? "border-accent bg-accent text-canvas" : "border-rule-strong"
                      }`}
                    >
                      {picked && <CheckIcon size={9} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{option.label}</span>
                      {option.description && (
                        <span className="mt-0.5 block text-[12px] text-ink-2">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {question.custom && (
              <input
                type="text"
                disabled={resolved || submitting}
                value={custom[question.id] ?? ""}
                onChange={(event) =>
                  setCustom((current) => ({ ...current, [question.id]: event.target.value }))
                }
                placeholder="Custom answer"
                className="mt-2 h-8 w-full rounded-md border border-rule bg-canvas px-2.5 font-sans text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
              />
            )}
          </div>
        ))}
        {!resolved && (
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-rule bg-canvas px-2.5 text-[12px] text-ink-2 transition-colors hover:border-error/60 hover:bg-error-soft/40 hover:text-error disabled:opacity-60"
            >
              <CloseIcon size={10} />
              Skip
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(false)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-accent/50 bg-accent-soft/60 px-2.5 text-[12px] text-accent-deep transition-colors hover:border-accent/80 hover:bg-accent-soft disabled:opacity-60"
            >
              <CheckIcon size={10} />
              Answer
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function seedAnswers(block: UserInputBlock): Record<string, string[]> {
  if (block.answers) return block.answers;
  const out: Record<string, string[]> = {};
  for (const question of block.questions) {
    const first = question.options[0]?.label;
    if (first && question.options.length === 1) out[question.id] = [first];
  }
  return out;
}

function toggleAnswer(
  current: Record<string, string[]>,
  questionId: string,
  label: string,
  multiSelect?: boolean,
): Record<string, string[]> {
  const existing = current[questionId] ?? [];
  if (!multiSelect) return { ...current, [questionId]: [label] };
  const next = existing.includes(label)
    ? existing.filter((value) => value !== label)
    : [...existing, label];
  return { ...current, [questionId]: next };
}

function mergeCustomAnswers(
  answers: Record<string, string[]>,
  custom: Record<string, string>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...answers };
  for (const [questionId, value] of Object.entries(custom)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    merged[questionId] = [...(merged[questionId] ?? []), trimmed];
  }
  return merged;
}

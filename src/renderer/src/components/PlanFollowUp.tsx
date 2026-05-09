import type { Thread } from "../state/types";
import { useStore } from "../state/store";
import { CheckIcon, SparkleIcon } from "./icons";

type Props = {
  thread: Thread;
};

export function PlanFollowUp({ thread }: Props) {
  const { updateThreadRunConfig, sendPrompt, state } = useStore();

  const last = thread.messages[thread.messages.length - 1];
  const isPlanReady =
    last &&
    last.role === "assistant" &&
    last.mode === "plan" &&
    last.status === "done" &&
    last.blocks.some((b) => b.kind === "text" && b.text.trim().length > 0);

  if (!isPlanReady) return null;
  if (state.pendings[thread.id]) return null;

  const proceed = (mode: "build" | "auto-edit") => {
    updateThreadRunConfig(thread.id, { mode });
    void sendPrompt("Proceed with the plan you just laid out.", thread.id);
  };

  return (
    <div className="border-t border-rule/60 bg-accent-soft/20">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-2">
        <span className="text-accent-deep">
          <SparkleIcon size={12} />
        </span>
        <span className="font-mono text-[11.5px] italic text-accent-deep">
          plan ready
        </span>
        <span className="text-[12px] text-ink-2">
          Approve to continue, or write a follow-up below.
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => proceed("auto-edit")}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-rule bg-canvas px-2 text-[11px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink"
          >
            Continue (auto-edit)
          </button>
          <button
            type="button"
            onClick={() => proceed("build")}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-accent/50 bg-accent-soft/60 px-2 text-[11px] text-accent-deep transition-colors hover:border-accent/80 hover:bg-accent-soft"
          >
            <CheckIcon size={10} />
            Continue (build)
          </button>
        </div>
      </div>
    </div>
  );
}

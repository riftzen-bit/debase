import { useMemo, useState, type ReactNode } from "react";
import type { Project, Thread } from "../state/types";
import { useStore } from "../state/store";
import { threadCwd } from "../lib/workdir";
import {
  buildPlanImplementationPrompt,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  latestProposedPlan,
  normalizePlanMarkdownForExport,
  stripDisplayedPlanMarkdown,
} from "../lib/proposedPlan";
import { CheckIcon, CloseIcon, CopyIcon, DocumentIcon, ExternalLinkIcon } from "./icons";
import { Markdown } from "./Markdown";

type Props = {
  project: Project;
  thread: Thread;
  onClose: () => void;
};

export function PlanSidebar({ project, thread, onClose }: Props) {
  const { sendPrompt, updateThreadRunConfig, state } = useStore();
  const plan = useMemo(() => latestProposedPlan(thread), [thread]);
  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cwd = threadCwd(project, thread);
  const displayedMarkdown = plan ? stripDisplayedPlanMarkdown(plan.markdown) : "";
  const busy = state.pendings[thread.id] != null;

  const copyPlan = () => {
    if (!plan) return;
    void navigator.clipboard.writeText(plan.markdown).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
      () => {
        setCopied(false);
      },
    );
  };

  const downloadPlan = () => {
    if (!plan) return;
    downloadPlanAsTextFile(
      buildProposedPlanMarkdownFilename(plan.markdown),
      normalizePlanMarkdownForExport(plan.markdown),
    );
  };

  const savePlan = () => {
    if (!plan || !cwd || saving) return;
    setSaving(true);
    setSaveError(null);
    void window.api.project
      .writeFile({
        projectPath: cwd,
        relativePath: buildProposedPlanMarkdownFilename(plan.markdown),
        contents: normalizePlanMarkdownForExport(plan.markdown),
      })
      .then((response) => {
        if (response.ok) {
          setSavedPath(response.path);
        } else {
          setSaveError(response.error);
        }
      })
      .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  const implementPlan = () => {
    if (!plan || busy) return;
    updateThreadRunConfig(thread.id, { mode: "build" });
    void sendPrompt(buildPlanImplementationPrompt(plan.markdown), thread.id);
  };

  return (
    <aside
      role="region"
      aria-label="Plan"
      className="flex h-full min-h-0 w-[380px] shrink-0 flex-col overflow-hidden border-l border-rule bg-canvas max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:top-[36px] max-md:z-30 max-md:w-auto"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-ink">Plan</span>
            {plan && (
              <span className="font-mono text-[10.5px] text-ink-3">
                {new Date(plan.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
          <p className="truncate text-[11.5px] text-ink-3">
            {plan ? plan.title : "No proposed plan in this thread"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close Plan panel"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-ink"
        >
          <CloseIcon size={12} />
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-rule/60 px-4 py-2">
        <ActionButton disabled={!plan} onClick={copyPlan} title="Copy plan">
          <CopyIcon size={11} />
          {copied ? "copied" : "copy"}
        </ActionButton>
        <ActionButton disabled={!plan} onClick={downloadPlan} title="Download plan">
          <ExternalLinkIcon size={11} />
          download
        </ActionButton>
        <ActionButton disabled={!plan || !cwd || saving} onClick={savePlan} title="Save plan to workspace">
          <DocumentIcon size={11} />
          {saving ? "saving" : "save"}
        </ActionButton>
        <button
          type="button"
          disabled={!plan || busy}
          onClick={implementPlan}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/50 bg-accent-soft/60 px-2.5 text-[11.5px] text-accent-deep transition-colors hover:border-accent/80 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckIcon size={11} />
          implement
        </button>
      </div>

      {savedPath && (
        <button
          type="button"
          onClick={() => void window.api.shell.openPath(savedPath)}
          className="shrink-0 border-b border-rule/60 px-4 py-2 text-left font-mono text-[11px] text-accent-deep hover:bg-accent-soft/30"
        >
          saved {savedPath}
        </button>
      )}
      {saveError && (
        <div className="shrink-0 border-b border-error/30 bg-error-soft/40 px-4 py-2 text-[11.5px] text-error">
          {saveError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {plan ? (
          <div className="prose-sm max-w-none">
            <Markdown cwd={cwd}>{displayedMarkdown || plan.markdown}</Markdown>
          </div>
        ) : (
          <div className="pt-6 text-[12.5px] leading-relaxed text-ink-3">
            <p className="font-mono italic">no plan yet</p>
            <p className="mt-2 max-w-xs">
              Switch the run mode to Plan, ask for a plan, and the latest plan-mode response will
              stay available here for review and implementation.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
  title,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-canvas px-2 text-[11.5px] text-ink-3 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

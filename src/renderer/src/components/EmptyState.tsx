import { useStore } from "../state/store";
import type { Project } from "../state/types";
import { ComposeIcon } from "./icons";

type Props = {
  project: Project;
};

export function EmptyState({ project }: Props) {
  const { newThread } = useStore();
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16">
      <div className="max-w-md space-y-5 text-center">
        <div className="space-y-1">
          <p className="font-mono text-[11.5px] italic text-ink-3">project</p>
          <h2 className="text-[22px] font-light leading-tight text-ink">{project.name}</h2>
          {project.path && (
            <p className="truncate font-mono text-[11.5px] text-ink-3">{project.path}</p>
          )}
        </div>
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          No threads here yet. Start one to ask Claude about this codebase.
        </p>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => newThread(project.id)}
            className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft/40 px-4 py-2 text-[13px] text-accent-deep transition-colors hover:border-accent/70 hover:bg-accent-soft"
          >
            <ComposeIcon size={13} />
            New thread
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useStore } from "../state/store";
import { ClaudeMark, FolderIcon, PlusIcon, SparkleIcon } from "./icons";

type Props = {
  onOpenSettings: () => void;
};

export function Welcome({ onOpenSettings }: Props) {
  const { newProject } = useStore();
  const [busy, setBusy] = useState(false);

  const onAddProject = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.api.dialog.chooseDirectory();
      if (result.ok) {
        const name = derive(result.path);
        newProject(name, result.path);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto px-8 py-16">
      <div className="grid w-full max-w-3xl grid-cols-1 gap-12 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 text-ink-2">
            <ClaudeMark size={20} />
            <span className="font-mono text-[12.5px] italic text-ink-3">
              debase · claude code shell
            </span>
          </div>
          <h1 className="text-[34px] font-light leading-[1.05] tracking-tight text-ink">
            Bring Claude Code into the room.
          </h1>
          <p className="max-w-md text-[14px] leading-relaxed text-ink-2">
            Point debase at a folder and it becomes the working directory for a Claude Code
            session. Threads, models, and permission modes live next to your project — no
            terminal, same agent.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onAddProject}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-accent/50 bg-accent-soft/40 px-4 py-2 text-[13px] text-accent-deep transition-colors hover:border-accent/70 hover:bg-accent-soft disabled:opacity-60"
            >
              <PlusIcon size={13} />
              Choose a folder
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-2 rounded-md border border-rule bg-canvas px-4 py-2 text-[13px] text-ink-2 transition-colors hover:border-rule-strong hover:text-ink"
            >
              Settings
            </button>
          </div>
        </div>

        <div className="hidden h-32 w-px bg-rule md:block" />

        <ul className="grid gap-3 text-[13px] text-ink-2">
          <Bullet
            icon={<FolderIcon size={13} />}
            heading="One folder = one project"
            body="The agent's working directory follows the project. Open multiple projects and switch between them from the sidebar."
          />
          <Bullet
            icon={<SparkleIcon size={13} />}
            heading="Plan, build, or full access"
            body="Pick a permission mode per thread — read-only planning, default prompts, auto-accept edits, or unrestricted."
          />
          <Bullet
            icon={<ClaudeMark size={13} />}
            heading="Original Claude Code"
            body="No custom system prompt. The agent runs through @anthropic-ai/claude-agent-sdk against your CLI login."
          />
        </ul>
      </div>
    </div>
  );
}

function Bullet({
  icon,
  heading,
  body,
}: {
  icon: React.ReactNode;
  heading: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-rule bg-surface text-ink-2">
        {icon}
      </span>
      <div className="space-y-1">
        <div className="text-[13px] font-medium text-ink">{heading}</div>
        <p className="text-[12.5px] leading-relaxed text-ink-3">{body}</p>
      </div>
    </li>
  );
}

function derive(path: string): string {
  if (!path) return "Untitled";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "Untitled";
}

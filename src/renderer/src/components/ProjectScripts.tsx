import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { Project, Thread } from "../state/types";
import type { ReadScriptsResponse } from "@shared/chat";
import { threadCwd } from "../lib/workdir";
import { MenuLabel, Popover } from "./Popover";
import { ChevronDownIcon, PaperPlaneIcon } from "./icons";

type Script = { name: string; command: string };
type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; manager: "bun" | "npm" | "pnpm" | "yarn"; scripts: Script[] }
  | { kind: "error"; message: string };

type Props = {
  project: Project;
  thread: Thread;
};

export function ProjectScripts({ project, thread }: Props) {
  const { sendPrompt, enqueuePrompt, state } = useStore();
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const isPending = state.pendings[thread.id] != null;
  const cwd = threadCwd(project, thread);

  useEffect(() => {
    if (!open) return;
    if (!cwd) {
      setLoad({ kind: "error", message: "Project has no working directory." });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    void window.api.project
      .readScripts({ projectPath: cwd })
      .then((res: ReadScriptsResponse) => {
        if (cancelled) return;
        if (res.ok) {
          setLoad({ kind: "loaded", manager: res.manager, scripts: res.scripts });
        } else {
          setLoad({ kind: "error", message: res.error });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, open]);

  if (!cwd) return null;

  const onRun = (script: Script) => {
    if (load.kind !== "loaded") return;
    const cmd = `${load.manager} run ${script.name}`;
    const text = `Run \`${cmd}\` and share what happened.`;
    if (isPending) enqueuePrompt(text, thread.id);
    else void sendPrompt(text, thread.id);
    setOpen(false);
  };

  return (
    <Popover
      align="end"
      width={320}
      placement="bottom"
      trigger={({ toggle, open: o }) => (
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            toggle();
          }}
          aria-expanded={o}
          title="Run a project script via Claude"
          className={`inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors ${
            o
              ? "border-rule-strong bg-surface text-ink"
              : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
          }`}
        >
          <span className="font-mono">scripts</span>
          <ChevronDownIcon size={10} />
        </button>
      )}
    >
      {() => (
        <div className="max-h-80 overflow-y-auto py-1">
          <MenuLabel>Project scripts</MenuLabel>
          {load.kind === "loading" && (
            <div className="px-3 py-3 text-[12px] text-ink-3">Loading…</div>
          )}
          {load.kind === "error" && (
            <div className="px-3 py-3 text-[12px] text-error">{load.message}</div>
          )}
          {load.kind === "loaded" && load.scripts.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-ink-3">
              No scripts in package.json.
            </div>
          )}
          {load.kind === "loaded" &&
            load.scripts.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => onRun(s)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface"
              >
                <span className="mt-0.5 text-ink-3">
                  <PaperPlaneIcon size={11} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">
                    {load.manager} run {s.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">
                    {s.command}
                  </span>
                </span>
              </button>
            ))}
          {load.kind === "loaded" && load.scripts.length > 0 && (
            <p className="border-t border-rule mt-1 px-3 pt-2 pb-1 text-[11px] italic text-ink-3">
              Picks queue a prompt for Claude — it runs the script via the Bash tool so output
              streams into the trace.
            </p>
          )}
        </div>
      )}
    </Popover>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CloseIcon, FolderOpenIcon, FolderPlusIcon, GitBranchIcon } from "./icons";

type CloneSource = "url" | "github" | "gitlab" | "bitbucket" | "azure-devops";

type Props = {
  open: boolean;
  onClose: () => void;
  onCloned: (name: string, path: string) => void;
};

export function CloneProjectDialog({ open, onClose, onCloned }: Props) {
  const [source, setSource] = useState<CloneSource>("url");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [destinationParentPath, setDestinationParentPath] = useState("");
  const [directoryName, setDirectoryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const suggestedDirectoryName = useMemo(() => deriveDirectoryName(repositoryUrl), [repositoryUrl]);
  const effectiveDirectoryName = directoryName.trim() || suggestedDirectoryName;
  const canClone = Boolean(repositoryUrl.trim() && destinationParentPath && !busy);
  const repositoryLabel = source === "url" ? "Repository" : `${sourceLabel(source)} repository`;
  const repositoryPlaceholder =
    source === "url"
      ? "https://github.com/owner/repo.git"
      : source === "github"
        ? "owner/repo"
        : source === "gitlab"
          ? "group/project"
          : source === "bitbucket"
            ? "workspace/repository"
            : "project/repository";

  if (!open) return null;

  const chooseDestination = async () => {
    if (busy) return;
    setError(null);
    const result = await window.api.dialog.chooseDirectory();
    if (result.ok) {
      setDestinationParentPath(result.path);
    } else if ("error" in result) {
      setError(result.error);
    }
  };

  const clone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canClone) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.project.gitClone({
        ...(source === "url"
          ? { repositoryUrl: repositoryUrl.trim() }
          : { provider: source, repository: repositoryUrl.trim(), protocol: "auto" as const }),
        destinationParentPath,
        directoryName: directoryName.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCloned(result.name, result.path);
      setRepositoryUrl("");
      setDestinationParentPath("");
      setDirectoryName("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clone Git repository"
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-ink/20" onMouseDown={close} />
      <form
        onSubmit={clone}
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-rule-strong bg-canvas shadow-md"
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <GitBranchIcon size={14} />
              Clone Git repository
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              Paste a Git URL or local repository path, then choose where the checkout should live.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            title="Close"
            aria-label="Close"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule text-ink-3 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            <CloseIcon size={12} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-5 gap-1 rounded-md border border-rule bg-surface p-1">
            {(["url", "github", "gitlab", "bitbucket", "azure-devops"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  if (busy) return;
                  setSource(option);
                  setRepositoryUrl("");
                  setDirectoryName("");
                  setError(null);
                }}
                className={`h-8 rounded-[5px] text-[12px] transition-colors ${
                  source === option
                    ? "bg-canvas text-ink shadow-sm"
                    : "text-ink-3 hover:bg-canvas/70 hover:text-ink-2"
                }`}
              >
                {sourceLabel(option)}
              </button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-ink-2">{repositoryLabel}</span>
            <input
              ref={inputRef}
              value={repositoryUrl}
              onChange={(event) => {
                setRepositoryUrl(event.target.value);
                setError(null);
              }}
              placeholder={repositoryPlaceholder}
              spellCheck={false}
              disabled={busy}
              className="h-9 w-full rounded-md border border-rule bg-surface px-3 font-mono text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent disabled:opacity-60"
            />
          </label>

          <div className="grid gap-2">
            <span className="text-[12px] font-medium text-ink-2">Destination</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={chooseDestination}
                disabled={busy}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-rule bg-canvas px-3 text-[12.5px] text-ink-2 transition-colors hover:border-rule-strong hover:bg-surface hover:text-ink disabled:opacity-60"
              >
                <FolderOpenIcon size={13} />
                Choose folder
              </button>
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-rule bg-surface px-3 font-mono text-[12px] text-ink-3">
                <span className="truncate">
                  {destinationParentPath || "No destination selected"}
                </span>
              </div>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-ink-2">Folder name</span>
            <input
              value={directoryName}
              onChange={(event) => {
                setDirectoryName(event.target.value);
                setError(null);
              }}
              placeholder={suggestedDirectoryName ? `Auto: ${suggestedDirectoryName}` : "Auto"}
              spellCheck={false}
              disabled={busy}
              className="h-9 w-full rounded-md border border-rule bg-surface px-3 font-mono text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent disabled:opacity-60"
            />
          </label>

          <div className="rounded-md border border-rule bg-surface px-3 py-2 text-[12px] text-ink-3">
            Checkout:{" "}
            <span className="font-mono text-ink-2">
              {destinationParentPath
                ? joinPreviewPath(destinationParentPath, effectiveDirectoryName || "repository")
                : "choose a destination"}
            </span>
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12.5px] leading-relaxed text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-rule bg-surface/60 px-4 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md border border-rule bg-canvas px-3 text-[12.5px] text-ink-2 transition-colors hover:border-rule-strong hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canClone}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-accent/50 bg-accent-soft/50 px-3 text-[12.5px] text-accent-deep transition-colors hover:border-accent/70 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderPlusIcon size={13} />
            {busy ? "Cloning..." : "Clone"}
          </button>
        </div>
      </form>
    </div>
  );
}

function deriveDirectoryName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  const normalized = withoutQuery.replace(/[\\/]+$/, "");
  const match = normalized.match(/([^\\/:]+?)(?:\.git)?$/);
  return sanitizeDirectoryName(match?.[1] ?? "");
}

function sourceLabel(source: CloneSource): string {
  switch (source) {
    case "url":
      return "Git URL";
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azure-devops":
      return "Azure";
  }
}

function sanitizeDirectoryName(input: string): string {
  return input
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/^\.+/g, "")
    .slice(0, 80);
}

function joinPreviewPath(parent: string, child: string): string {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

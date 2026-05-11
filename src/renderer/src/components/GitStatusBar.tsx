import { useEffect, useMemo, useState } from "react";
import type { GitDiffResponse, GitListRefsResponse, GitRef, GitStatusResponse } from "@shared/chat";
import type { SourceControlListChangeRequestsResponse } from "@shared/sourceControl";
import type { Project, Thread } from "../state/types";
import { useStore } from "../state/store";
import { FileIcon } from "../lib/fileIcons";
import { truncate } from "../lib/format";
import { threadCwd } from "../lib/workdir";
import { DiffIcon, ExternalLinkIcon, FolderIcon, ResetIcon } from "./icons";
import { Popover } from "./Popover";

type Props = {
  project: Project;
  thread: Thread;
};

type StatusState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; status: Extract<GitStatusResponse, { ok: true; isRepo: true }> }
  | { kind: "not-repo" }
  | { kind: "error"; message: string };

type DiffState =
  | { kind: "closed" }
  | {
      kind: "loading" | "ready" | "error";
      file: Extract<GitStatusResponse, { ok: true; isRepo: true }>["files"][number];
      diff?: string;
      message?: string;
    };

type RefState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; refs: GitRef[]; totalCount: number }
  | { kind: "not-repo" }
  | { kind: "error"; message: string };

type ChangeRequestState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; response: Extract<SourceControlListChangeRequestsResponse, { ok: true }> }
  | { kind: "error"; message: string };

type ChangeRequestCreateState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "created"; message: string }
  | { kind: "error"; message: string };

const MAX_DIFF_PREVIEW_CHARS = 60_000;

export function GitStatusBar({ project, thread }: Props) {
  const [state, setState] = useState<StatusState>({ kind: "idle" });
  const cwd = threadCwd(project, thread);

  const refresh = async () => {
    if (!cwd) {
      setState({ kind: "not-repo" });
      return;
    }
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    const response = await window.api.project.gitStatus({ projectPath: cwd });
    if (!response.ok) {
      setState({ kind: "error", message: response.error });
      return;
    }
    if (!response.isRepo) {
      setState({ kind: "not-repo" });
      return;
    }
    setState({ kind: "ready", status: response });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cwd, thread.id, thread.updatedAt]);

  if (state.kind === "not-repo" || state.kind === "idle") return null;

  return (
    <div className="border-b border-rule/60 bg-surface/20">
      <div className="mx-auto flex w-full max-w-3xl min-w-0 items-center gap-2 overflow-hidden px-4 py-2 text-[11.5px] text-ink-3 sm:px-6">
        {state.kind === "ready" ? (
          <ReadyStatus
            projectPath={cwd}
            projectRoot={project.path}
            thread={thread}
            status={state.status}
            onRefresh={refresh}
          />
        ) : state.kind === "error" ? (
          <>
            <span className="text-error">git</span>
            <span className="truncate">{state.message}</span>
            <RefreshButton onRefresh={refresh} />
          </>
        ) : (
          <>
            <span className="text-ink-4">
              <FolderIcon size={12} />
            </span>
            <span className="font-mono italic">checking git</span>
          </>
        )}
      </div>
    </div>
  );
}

function ReadyStatus({
  projectPath,
  projectRoot,
  thread,
  status,
  onRefresh,
}: {
  projectPath: string;
  projectRoot: string;
  thread: Thread;
  status: Extract<GitStatusResponse, { ok: true; isRepo: true }>;
  onRefresh: () => void;
}) {
  const dirty = status.staged + status.unstaged + status.untracked + status.conflicted;
  const filePreview = useMemo(
    () => status.files.slice(0, 3).map((f) => f.path).join(", "),
    [status.files],
  );

  return (
    <>
      <span className="shrink-0 text-ink-4">
        <FolderIcon size={12} />
      </span>
      <BranchControl
        projectPath={projectPath}
        projectRoot={projectRoot}
        thread={thread}
        currentBranch={status.branch}
        onRefresh={onRefresh}
      />
      {status.upstream && (
        <>
          <span className="hidden shrink-0 text-ink-4 sm:inline">{"->"}</span>
          <span className="hidden min-w-0 max-w-[160px] truncate font-mono md:inline">
            {status.upstream}
          </span>
        </>
      )}
      <span className="hidden shrink-0 md:inline-flex">
        <WorktreeControl
          projectRoot={projectRoot}
          thread={thread}
          currentBranch={status.branch}
        />
      </span>
      <ChangeRequestControl
        projectPath={projectPath}
        currentBranch={status.branch}
        refreshKey={`${thread.id}:${thread.updatedAt}:${status.branch ?? ""}`}
        onRefresh={onRefresh}
      />
      {(status.ahead > 0 || status.behind > 0) && (
        <span className="hidden shrink-0 whitespace-nowrap rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2 lg:inline-block">
          {status.ahead > 0 ? `ahead ${status.ahead}` : ""}
          {status.ahead > 0 && status.behind > 0 ? " / " : ""}
          {status.behind > 0 ? `behind ${status.behind}` : ""}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px]">
        {dirty > 0 ? (
          <DirtyFilesPopover projectPath={projectPath} status={status} dirty={dirty} />
        ) : (
          <span className="text-ink-3">clean</span>
        )}
        {status.staged > 0 && <span className="text-add">S {status.staged}</span>}
        {status.unstaged > 0 && <span className="text-del">M {status.unstaged}</span>}
        {status.untracked > 0 && <span className="text-ink-2">? {status.untracked}</span>}
        {status.conflicted > 0 && <span className="text-error">! {status.conflicted}</span>}
      </div>
      {filePreview && (
        <span
          className="hidden min-w-0 max-w-[220px] truncate border-l border-rule pl-2 italic text-ink-3 xl:inline"
          title={status.files.map((f) => f.path).join("\n")}
        >
          <DiffIcon size={11} className="mr-1 inline align-[-2px]" />
          {truncate(filePreview, 58)}
        </span>
      )}
      <RefreshButton onRefresh={onRefresh} />
    </>
  );
}

function ChangeRequestControl({
  projectPath,
  currentBranch,
  refreshKey,
  onRefresh,
}: {
  projectPath: string;
  currentBranch: string | null;
  refreshKey: string;
  onRefresh: () => void;
}) {
  const [state, setState] = useState<ChangeRequestState>({ kind: "idle" });
  const [openError, setOpenError] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState<
    | { kind: "idle" }
    | { kind: "checking-out"; key: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [createState, setCreateState] = useState<ChangeRequestCreateState>({ kind: "idle" });
  const [createTitle, setCreateTitle] = useState(() => defaultChangeRequestTitle(currentBranch));
  const [createBase, setCreateBase] = useState("");
  const [createBody, setCreateBody] = useState("");

  useEffect(() => {
    if (!currentBranch) {
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    setCreateState({ kind: "idle" });
    setCreateTitle(defaultChangeRequestTitle(currentBranch));
    setCreateBase("");
    setCreateBody("");
    void window.api.project
      .sourceControlListChangeRequests({
        projectPath,
        headRefName: currentBranch,
        state: "open",
        limit: 5,
      })
      .then((response) => {
        if (!alive) return;
        setState(response.ok ? { kind: "ready", response } : { kind: "error", message: response.error });
      });
    return () => {
      alive = false;
    };
  }, [currentBranch, projectPath, refreshKey]);

  if (!currentBranch) return null;

  const first =
    state.kind === "ready" && state.response.changeRequests.length > 0
      ? state.response.changeRequests[0]
      : null;
  const providerLabel = first?.provider === "gitlab" ? "MR" : "PR";
  const triggerText = first
    ? `${providerLabel} ${first.provider === "gitlab" ? "!" : "#"}${first.number}`
    : state.kind === "loading"
      ? "review"
      : "no PR";

  const openChangeRequest = (url: string) => {
    setOpenError(null);
    void window.api.project
      .sourceControlOpenChangeRequest({ projectPath, url })
      .then((response) => {
        if (!response.ok) setOpenError(response.error);
      });
  };

  const checkoutChangeRequest = (
    request: Extract<
      SourceControlListChangeRequestsResponse,
      { ok: true }
    >["changeRequests"][number],
  ) => {
    const key = `${request.provider}:${request.number}`;
    setCheckoutState({ kind: "checking-out", key });
    void window.api.project
      .sourceControlCheckoutChangeRequest({
        projectPath,
        provider: request.provider,
        number: request.number,
      })
      .then((response) => {
        if (!response.ok) {
          setCheckoutState({ kind: "error", message: response.error });
          return;
        }
        setCheckoutState({ kind: "idle" });
        void onRefresh();
      });
  };

  const createChangeRequest = () => {
    if (state.kind !== "ready") return;
    if (
      state.response.provider !== "github" &&
      state.response.provider !== "gitlab" &&
      state.response.provider !== "bitbucket" &&
      state.response.provider !== "azure-devops"
    ) return;
    const title = createTitle.trim();
    if (!title) {
      setCreateState({ kind: "error", message: "Title is required." });
      return;
    }
    setCreateState({ kind: "creating" });
    void window.api.project
      .sourceControlCreateChangeRequest({
        projectPath,
        provider: state.response.provider,
        title,
        body: createBody,
        baseRefName: createBase.trim() || undefined,
        push: true,
      })
      .then((response) => {
        if (!response.ok) {
          setCreateState({ kind: "error", message: response.error });
          return;
        }
        setCreateState({
          kind: "created",
          message: response.status === "existing" ? "Existing review found." : "Review created.",
        });
        setState((prev) => {
          if (prev.kind !== "ready" || !response.changeRequest) return prev;
          return {
            kind: "ready",
            response: {
              ...prev.response,
              provider: response.provider,
              branch: response.branch,
              changeRequests: [response.changeRequest],
            },
          };
        });
        void onRefresh();
      });
  };

  const canCreate =
    state.kind === "ready" &&
    (state.response.provider === "github" ||
      state.response.provider === "gitlab" ||
      state.response.provider === "bitbucket" ||
      state.response.provider === "azure-devops");
  const createLabel =
    state.kind === "ready" && state.response.provider === "gitlab" ? "MR" : "PR";

  return (
    <Popover
      align="start"
      width={340}
      placement="bottom"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${
            first
              ? "border-accent/50 bg-accent-soft/50 text-accent-deep"
              : open
                ? "border-rule-strong bg-surface text-ink"
                : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
          }`}
          title="Open pull or merge request"
        >
          {triggerText}
        </button>
      )}
    >
      {() => (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] italic text-ink-3">review</span>
            <span className="truncate font-mono text-[10.5px] text-ink-3">
              {currentBranch}
            </span>
          </div>
          {state.kind === "loading" ? (
            <div className="mt-2 font-mono text-[11px] italic text-ink-3">checking branch</div>
          ) : state.kind === "error" ? (
            <div className="mt-2 text-[11.5px] text-error">{state.message}</div>
          ) : state.kind === "ready" && state.response.changeRequests.length > 0 ? (
            <div className="mt-2 space-y-1">
              {state.response.changeRequests.map((request) => (
                <div
                  key={`${request.provider}:${request.number}:${request.url}`}
                  className="group flex w-full items-start gap-2 rounded-sm border border-rule px-2 py-1.5 text-left hover:border-rule-strong hover:bg-surface"
                >
                  <span className="shrink-0 font-mono text-[11px] text-accent-deep">
                    {request.provider === "gitlab" ? "!" : "#"}
                    {request.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink-2" title={request.title}>
                      {request.title}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-3">
                      {request.baseRefName || "base"} {"<-"} {request.headRefName || currentBranch}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => checkoutChangeRequest(request)}
                    disabled={
                      checkoutState.kind === "checking-out" &&
                      checkoutState.key === `${request.provider}:${request.number}`
                    }
                    className="shrink-0 whitespace-nowrap rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 hover:border-rule-strong hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {checkoutState.kind === "checking-out" &&
                    checkoutState.key === `${request.provider}:${request.number}`
                      ? "checking"
                      : "checkout"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openChangeRequest(request.url)}
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-surface-2 hover:text-ink-2"
                    title="Open review"
                    aria-label="Open review"
                  >
                    <ExternalLinkIcon size={11} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="text-[11.5px] text-ink-3">
                No open PR/MR found for this branch.
              </div>
              {canCreate ? (
                <div className="rounded-sm border border-rule bg-surface/40 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="whitespace-nowrap text-[11px] italic text-ink-3">
                      create {createLabel}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-ink-4" title={currentBranch}>
                      {currentBranch}
                    </span>
                  </div>
                  <label className="block text-[10.5px] text-ink-3">Title</label>
                  <input
                    value={createTitle}
                    onChange={(event) => setCreateTitle(event.target.value)}
                    className="mt-1 h-7 w-full rounded-sm border border-rule bg-canvas px-2 text-[12px] text-ink outline-none focus:border-rule-strong"
                    spellCheck={false}
                  />
                  <label className="mt-2 block text-[10.5px] text-ink-3">Base</label>
                  <input
                    value={createBase}
                    onChange={(event) => setCreateBase(event.target.value)}
                    placeholder="default branch"
                    className="mt-1 h-7 w-full rounded-sm border border-rule bg-canvas px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-4 focus:border-rule-strong"
                    spellCheck={false}
                  />
                  <label className="mt-2 block text-[10.5px] text-ink-3">Body</label>
                  <textarea
                    value={createBody}
                    onChange={(event) => setCreateBody(event.target.value)}
                    rows={3}
                    className="mt-1 w-full resize-none rounded-sm border border-rule bg-canvas px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-4 focus:border-rule-strong"
                    placeholder="optional"
                    spellCheck
                  />
                  <button
                    type="button"
                    onClick={createChangeRequest}
                    disabled={!createTitle.trim() || createState.kind === "creating"}
                    className="mt-2 inline-flex min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-accent/50 bg-accent-soft/50 px-2 py-1 text-[11.5px] text-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createState.kind === "creating" ? "Creating" : `Push + ${createLabel}`}
                  </button>
                </div>
              ) : null}
            </div>
          )}
          {openError && <div className="mt-2 text-[11.5px] text-error">{openError}</div>}
          {checkoutState.kind === "error" && (
            <div className="mt-2 text-[11.5px] text-error">{checkoutState.message}</div>
          )}
          {createState.kind === "error" && (
            <div className="mt-2 text-[11.5px] text-error">{createState.message}</div>
          )}
          {createState.kind === "created" && (
            <div className="mt-2 text-[11.5px] text-accent-deep">{createState.message}</div>
          )}
        </div>
      )}
    </Popover>
  );
}

function BranchControl({
  projectPath,
  projectRoot,
  thread,
  currentBranch,
  onRefresh,
}: {
  projectPath: string;
  projectRoot: string;
  thread: Thread;
  currentBranch: string | null;
  onRefresh: () => void;
}) {
  const { setThreadWorktree } = useStore();
  const [refState, setRefState] = useState<RefState>({ kind: "idle" });
  const [selectedRef, setSelectedRef] = useState(currentBranch ?? "");
  const [newRef, setNewRef] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "switching" }
    | { kind: "creating" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    let alive = true;
    setRefState({ kind: "loading" });
    void window.api.project.gitListRefs({ projectPath, limit: 80 }).then((res) => {
      if (!alive) return;
      setRefState(resolveRefState(res));
      if (res.ok && res.isRepo) {
        const preferred = currentBranch ?? res.refs.find((ref) => ref.current)?.name ?? "";
        setSelectedRef(preferred);
      }
    });
    return () => {
      alive = false;
    };
  }, [currentBranch, projectPath, thread.id, thread.updatedAt]);

  const switchRef = (close: () => void) => {
    if (!selectedRef || state.kind === "switching") return;
    const ref = refState.kind === "ready"
      ? refState.refs.find((candidate) => candidate.name === selectedRef)
      : null;
    if (ref?.worktreePath) {
      const nextWorktreePath = samePath(ref.worktreePath, projectRoot) ? null : ref.worktreePath;
      setThreadWorktree(thread.id, nextWorktreePath);
      close();
      return;
    }
    setState({ kind: "switching" });
    void window.api.project
      .gitSwitchRef({ projectPath, refName: selectedRef })
      .then((res) => {
        if (!res.ok) {
          setState({ kind: "error", message: res.error });
          return;
        }
        setState({ kind: "idle" });
        close();
        void onRefresh();
      });
  };

  const createRef = (close: () => void) => {
    const refName = newRef.trim();
    if (!refName || state.kind === "creating") return;
    setState({ kind: "creating" });
    void window.api.project
      .gitCreateRef({ projectPath, refName, switchRef: true })
      .then((res) => {
        if (!res.ok) {
          setState({ kind: "error", message: res.error });
          return;
        }
        setSelectedRef(res.refName);
        setNewRef("");
        setState({ kind: "idle" });
        close();
        void onRefresh();
      });
  };

  return (
    <Popover
      align="start"
      width={320}
      placement="bottom"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={`min-w-0 max-w-[120px] truncate whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors sm:max-w-[160px] ${
            open
              ? "border-rule-strong bg-surface text-ink"
              : "border-transparent text-ink-2 hover:border-rule hover:bg-surface"
          }`}
          title="Switch git ref"
        >
          {currentBranch ?? "detached"}
        </button>
      )}
    >
      {({ close }) => (
        <div className="px-3 py-2">
          <div className="text-[11px] italic text-ink-3">checkout</div>
          <label className="mt-2 block text-[11px] text-ink-3">Ref</label>
          <select
            value={selectedRef}
            onChange={(event) => setSelectedRef(event.target.value)}
            className="mt-1 h-7 w-full rounded-sm border border-rule bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-rule-strong"
          >
            {selectedRef && !refNameExists(refState, selectedRef) && (
              <option value={selectedRef}>{selectedRef}</option>
            )}
            {refState.kind === "ready" ? (
              refState.refs.map((ref) => (
                <option key={ref.name} value={ref.name}>
                  {formatRefOption(ref)}
                </option>
              ))
            ) : (
              <option value={selectedRef}>{selectedRef || "loading refs"}</option>
            )}
          </select>
          <div className="mt-1 font-mono text-[10.5px] text-ink-3">
            {formatRefState(refState)}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={!selectedRef || state.kind === "switching"}
              onClick={() => switchRef(close)}
              className="rounded-sm border border-rule px-2 py-1 text-[11.5px] text-ink-2 hover:border-rule-strong hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state.kind === "switching" ? "Switching" : "Switch"}
            </button>
          </div>
          <label className="mt-3 block text-[11px] text-ink-3">New branch</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={newRef}
              onChange={(event) => setNewRef(event.target.value)}
              placeholder="feature/update"
              className="h-7 min-w-0 flex-1 rounded-sm border border-rule bg-surface px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-4 focus:border-rule-strong"
              spellCheck={false}
            />
            <button
              type="button"
              disabled={!newRef.trim() || state.kind === "creating"}
              onClick={() => createRef(close)}
              className="rounded-sm border border-accent/50 bg-accent-soft/50 px-2 py-1 text-[11.5px] text-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state.kind === "creating" ? "Creating" : "Create"}
            </button>
          </div>
          {state.kind === "error" && (
            <div className="mt-2 text-[11.5px] text-error">{state.message}</div>
          )}
        </div>
      )}
    </Popover>
  );
}

function WorktreeControl({
  projectRoot,
  thread,
  currentBranch,
}: {
  projectRoot: string;
  thread: Thread;
  currentBranch: string | null;
}) {
  const { setThreadWorktree } = useStore();
  const [branchName, setBranchName] = useState(() => defaultWorktreeBranch(thread.title));
  const [baseRef, setBaseRef] = useState(currentBranch ?? "HEAD");
  const [refState, setRefState] = useState<RefState>({ kind: "idle" });
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "creating" }
    | { kind: "removing" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    setBranchName(defaultWorktreeBranch(thread.title));
    setBaseRef(currentBranch ?? "HEAD");
    setState({ kind: "idle" });
  }, [currentBranch, thread.id, thread.title]);

  useEffect(() => {
    let alive = true;
    setRefState({ kind: "loading" });
    void window.api.project
      .gitListRefs({ projectPath: projectRoot, limit: 80 })
      .then((res) => {
        if (!alive) return;
        setRefState(resolveRefState(res));
        if (res.ok && res.isRepo) {
          const preferred =
            res.refs.find((ref) => ref.current)?.name ??
            res.refs.find((ref) => ref.isDefault)?.name ??
            res.refs[0]?.name;
          if (preferred) setBaseRef((current) => (current === "HEAD" ? preferred : current));
        }
      });
    return () => {
      alive = false;
    };
  }, [projectRoot, thread.id]);

  if (!projectRoot) return null;

  return (
    <Popover
      align="start"
      width={320}
      placement="bottom"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap transition-colors ${
            thread.worktreePath
              ? "border-accent/50 bg-accent-soft/50 text-accent-deep"
              : open
                ? "border-rule-strong bg-surface text-ink"
                : "border-rule bg-canvas text-ink-3 hover:border-rule-strong hover:bg-surface hover:text-ink-2"
          }`}
          title={thread.worktreePath ? thread.worktreePath : "Create a worktree for this thread"}
        >
          {thread.worktreePath ? "worktree" : "+ worktree"}
        </button>
      )}
    >
      {({ close }) => (
        <div className="px-3 py-2">
          <div className="text-[11px] italic text-ink-3">
            {thread.worktreePath ? "thread worktree" : "new worktree"}
          </div>
          {thread.worktreePath ? (
            <>
              <div className="mt-1 break-all font-mono text-[11px] text-ink-2">
                {thread.worktreePath}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void window.api.shell.openPath(thread.worktreePath!)}
                  className="rounded-sm border border-rule px-2 py-1 text-[11.5px] text-ink-2 hover:border-rule-strong hover:bg-surface"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setThreadWorktree(thread.id, null);
                    close();
                  }}
                  className="rounded-sm border border-rule px-2 py-1 text-[11.5px] text-ink-2 hover:border-rule-strong hover:bg-surface"
                >
                  Use project root
                </button>
                <button
                  type="button"
                  disabled={state.kind === "removing"}
                  onClick={() => {
                    if (!thread.worktreePath) return;
                    const ok = window.confirm(
                      `Delete this git worktree?\n\n${thread.worktreePath}`,
                    );
                    if (!ok) return;
                    setState({ kind: "removing" });
                    void window.api.project
                      .gitRemoveWorktree({
                        projectPath: projectRoot,
                        worktreePath: thread.worktreePath,
                        force: true,
                      })
                      .then((res) => {
                        if (!res.ok) {
                          setState({ kind: "error", message: res.error });
                          return;
                        }
                        setThreadWorktree(thread.id, null);
                        setState({ kind: "idle" });
                        close();
                      });
                  }}
                  className="rounded-sm border border-del/40 px-2 py-1 text-[11.5px] text-del hover:bg-del/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {state.kind === "removing" ? "Deleting" : "Delete"}
                </button>
              </div>
              {state.kind === "error" && (
                <div className="mt-2 text-[11.5px] text-error">{state.message}</div>
              )}
            </>
          ) : (
            <form
              className="mt-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (state.kind === "creating") return;
                const nextBranch = branchName.trim();
                if (!nextBranch) {
                  setState({ kind: "error", message: "Branch name is required." });
                  return;
                }
                setState({ kind: "creating" });
                void window.api.project
                  .gitCreateWorktree({
                    projectPath: projectRoot,
                    branchName: nextBranch,
                    startPoint: baseRef || currentBranch || undefined,
                  })
                  .then((res) => {
                    if (!res.ok) {
                      setState({ kind: "error", message: res.error });
                      return;
                    }
                    setThreadWorktree(thread.id, res.worktreePath);
                    setState({ kind: "idle" });
                    close();
                  });
              }}
            >
              <label className="block text-[11px] text-ink-3">Branch</label>
              <input
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                className="mt-1 h-7 w-full rounded-sm border border-rule bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-rule-strong"
                spellCheck={false}
              />
              <label className="mt-2 block text-[11px] text-ink-3">Base</label>
              <select
                value={baseRef}
                onChange={(event) => setBaseRef(event.target.value)}
                className="mt-1 h-7 w-full rounded-sm border border-rule bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-rule-strong"
              >
                {baseRef && !refNameExists(refState, baseRef) && (
                  <option value={baseRef}>{baseRef}</option>
                )}
                {refState.kind === "ready" ? (
                  refState.refs.map((ref) => (
                    <option key={ref.name} value={ref.name}>
                      {formatRefOption(ref)}
                    </option>
                  ))
                ) : (
                  <option value={baseRef}>{baseRef || "HEAD"}</option>
                )}
              </select>
              <div className="mt-1 font-mono text-[10.5px] text-ink-3">
                {formatRefState(refState)}
              </div>
              {state.kind === "error" && (
                <div className="mt-2 text-[11.5px] text-error">{state.message}</div>
              )}
              <button
                type="submit"
                disabled={state.kind === "creating"}
                className="mt-2 rounded-sm border border-accent/50 bg-accent-soft/50 px-2 py-1 text-[11.5px] text-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state.kind === "creating" ? "Creating" : "Create worktree"}
              </button>
            </form>
          )}
        </div>
      )}
    </Popover>
  );
}

function resolveRefState(response: GitListRefsResponse): RefState {
  if (!response.ok) return { kind: "error", message: response.error };
  if (!response.isRepo) return { kind: "not-repo" };
  return { kind: "ready", refs: response.refs, totalCount: response.totalCount };
}

function refNameExists(state: RefState, refName: string): boolean {
  return state.kind === "ready" && state.refs.some((ref) => ref.name === refName);
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
  return normalize(a) === normalize(b);
}

function formatRefOption(ref: GitRef): string {
  const marks = [
    ref.current ? "current" : "",
    ref.isDefault ? "default" : "",
    ref.isRemote ? "remote" : "",
    ref.worktreePath ? "worktree" : "",
  ].filter(Boolean);
  return marks.length > 0 ? `${ref.name} (${marks.join(", ")})` : ref.name;
}

function formatRefState(state: RefState): string {
  switch (state.kind) {
    case "ready":
      return `${state.refs.length} of ${state.totalCount} refs`;
    case "not-repo":
      return "refs unavailable";
    case "error":
      return truncate(state.message, 72);
    default:
      return "loading refs";
  }
}

function DirtyFilesPopover({
  projectPath,
  status,
  dirty,
}: {
  projectPath: string;
  status: Extract<GitStatusResponse, { ok: true; isRepo: true }>;
  dirty: number;
}) {
  const [diffState, setDiffState] = useState<DiffState>({ kind: "closed" });

  const loadDiff = async (
    file: Extract<GitStatusResponse, { ok: true; isRepo: true }>["files"][number],
  ) => {
    const currentKey = `${file.index}:${file.worktree}:${file.path}`;
    setDiffState({ kind: "loading", file });
    const response = await window.api.project.gitDiff({
      projectPath,
      filePath: file.path,
    });
    setDiffState((prev) => {
      if (prev.kind === "closed") return prev;
      const prevKey = `${prev.file.index}:${prev.file.worktree}:${prev.file.path}`;
      if (prevKey !== currentKey) return prev;
      return resolveDiffState(file, response);
    });
  };

  return (
    <Popover
      align="end"
      width={360}
      placement="bottom"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="rounded-sm px-1 py-0.5 text-accent-deep transition-colors hover:bg-accent-soft/60"
          title="Show changed files"
        >
          {dirty} changed
        </button>
      )}
    >
      {() => (
        <div className="py-1">
          <div className="flex items-center justify-between gap-2 px-3 pb-1 text-[11px] italic text-ink-3">
            <span>working tree</span>
            <span className="font-mono not-italic">
              {status.files.length} file{status.files.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-h-[320px] overflow-auto border-t border-rule/70 pt-1">
            {status.files.map((file) => (
              <GitFileRow
                key={`${file.index}:${file.worktree}:${file.path}`}
                file={file}
                projectPath={projectPath}
                diffOpen={diffState.kind !== "closed" && diffState.file.path === file.path}
                onViewDiff={() => void loadDiff(file)}
              />
            ))}
          </div>
          {diffState.kind !== "closed" && (
            <DiffPreview
              state={diffState}
              onClose={() => setDiffState({ kind: "closed" })}
            />
          )}
        </div>
      )}
    </Popover>
  );
}

function GitFileRow({
  file,
  projectPath,
  diffOpen,
  onViewDiff,
}: {
  file: Extract<GitStatusResponse, { ok: true; isRepo: true }>["files"][number];
  projectPath: string;
  diffOpen: boolean;
  onViewDiff: () => void;
}) {
  const absolute = joinPath(projectPath, file.path);
  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-surface">
      <span className={`w-7 shrink-0 font-mono ${statusTone(file.index, file.worktree)}`}>
        {statusLabel(file.index, file.worktree)}
      </span>
      <span className="shrink-0 text-ink-3">
        <FileIcon name={file.path} size={12} />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-ink-2" title={file.path}>
        {file.path}
      </span>
      <button
        type="button"
        onClick={onViewDiff}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-opacity hover:bg-surface-2 hover:text-ink-2 focus-visible:opacity-100 ${
          diffOpen ? "text-accent-deep opacity-100" : "text-ink-3 opacity-0 group-hover:opacity-100"
        }`}
        title={`View diff for ${file.path}`}
        aria-label={`View diff for ${file.path}`}
      >
        <DiffIcon size={10} />
      </button>
      <button
        type="button"
        onClick={() => void window.api.shell.openPath(absolute)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink-2 group-hover:opacity-100 focus-visible:opacity-100"
        title={`Reveal ${absolute}`}
        aria-label={`Reveal ${file.path}`}
      >
        <ExternalLinkIcon size={10} />
      </button>
    </div>
  );
}

function DiffPreview({ state, onClose }: { state: Exclude<DiffState, { kind: "closed" }>; onClose: () => void }) {
  const title = state.file.path;
  const text = state.diff ?? "";
  const clipped = text.length > MAX_DIFF_PREVIEW_CHARS;
  const preview = clipped ? text.slice(0, MAX_DIFF_PREVIEW_CHARS) : text;
  return (
    <div className="border-t border-rule bg-canvas">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-2" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-surface hover:text-ink"
        >
          close
        </button>
      </div>
      {state.kind === "loading" ? (
        <div className="px-3 pb-3 font-mono text-[11px] italic text-ink-3">loading diff</div>
      ) : state.kind === "error" ? (
        <div className="px-3 pb-3 text-[12px] text-error">{state.message}</div>
      ) : preview.length === 0 ? (
        <div className="px-3 pb-3 text-[12px] text-ink-3">No text diff.</div>
      ) : (
        <>
          <pre className="max-h-[260px] overflow-auto border-t border-rule/70 bg-surface/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-2">
            {preview}
          </pre>
          {clipped && (
            <div className="border-t border-rule/70 px-3 py-1.5 text-[11px] text-ink-3">
              Diff preview clipped at {MAX_DIFF_PREVIEW_CHARS.toLocaleString()} characters.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function resolveDiffState(
  file: Extract<GitStatusResponse, { ok: true; isRepo: true }>["files"][number],
  response: GitDiffResponse,
): DiffState {
  if (!response.ok) {
    return { kind: "error", file, message: response.error };
  }
  return { kind: "ready", file, diff: response.diff };
}

function defaultWorktreeBranch(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[/.-]+$/g, "")
    .replace(/^[/.-]+/g, "");
  return `debase/${slug || "thread"}`;
}

function defaultChangeRequestTitle(branch: string | null): string {
  if (!branch) return "";
  const cleaned = branch
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/[-_]+/g, " ")
    .trim();
  if (!cleaned) return branch;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function statusLabel(index: string, worktree: string): string {
  if (index === "?" && worktree === "?") return "??";
  if (isConflict(index, worktree)) return "!!";
  return `${index === " " ? "-" : index}${worktree === " " ? "-" : worktree}`;
}

function statusTone(index: string, worktree: string): string {
  if (index === "?" && worktree === "?") return "text-ink-3";
  if (isConflict(index, worktree)) return "text-error";
  if (index !== " " && index !== "?") return "text-add";
  return "text-del";
}

function isConflict(index: string, worktree: string): boolean {
  return (
    index === "U" ||
    worktree === "U" ||
    (index === "A" && worktree === "A") ||
    (index === "D" && worktree === "D")
  );
}

function joinPath(root: string, relative: string): string {
  const sep = root.includes("\\") || /^[a-zA-Z]:/.test(root) ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${relative.replace(/\//g, sep)}`;
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={() => void onRefresh()}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
      title="Refresh git status"
      aria-label="Refresh git status"
    >
      <ResetIcon size={12} />
    </button>
  );
}

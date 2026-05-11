import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { homedir, platform, tmpdir } from "node:os";
import { runClaude } from "./agent/claude";
import { runCodex } from "./agent/codex";
import { loadCursorCatalog, runCursor } from "./agent/cursor";
import { loadOpenCodeCatalog, runOpenCode } from "./agent/opencode";
import {
  addProjectRoot,
  bootstrapAllowlist,
  isInsideAllowedRoot,
} from "./security";
import { TerminalManager } from "./terminal";
import { IpcChannel } from "@shared/ipc";
import { EMPTY_PROVIDER_CATALOG, findModel, isCustomModelAllowed } from "@shared/providers";
import type {
  ProviderCatalogRequest,
  ProviderCatalogResponse,
  ProviderRuntimeConfig,
  ProviderRuntimeSettings,
} from "@shared/providers";
import type {
  ChangeRequestState,
  GitCloneRequest,
  GitCloneResponse,
  SourceControlCheckoutChangeRequestRequest,
  SourceControlCheckoutChangeRequestResponse,
  SourceControlChangeRequest,
  SourceControlCreateChangeRequestRequest,
  SourceControlCreateChangeRequestResponse,
  SourceControlListChangeRequestsRequest,
  SourceControlListChangeRequestsResponse,
  SourceControlOpenChangeRequestRequest,
  SourceControlOpenChangeRequestResponse,
  SourceControlPublishRepositoryRequest,
  SourceControlPublishRepositoryResponse,
  SourceControlRepositoryInfo,
  SourceControlProviderDiscovery,
  SourceControlProviderKind,
  SourceControlRemote,
  SourceControlScanRequest,
  SourceControlScanResponse,
} from "@shared/sourceControl";
import type {
  CancelPromptRequest,
  ChatEvent,
  ChatEventEnvelope,
  ChooseDirectoryResponse,
  ChooseFilesRequest,
  ChooseFilesResponse,
  EnvironmentInfo,
  GitCreateRefRequest,
  GitCreateRefResponse,
  GitCreateWorktreeRequest,
  GitCreateWorktreeResponse,
  GitDiffRequest,
  GitDiffResponse,
  GitListRefsRequest,
  GitListRefsResponse,
  GitRef,
  GitRemoveWorktreeRequest,
  GitRemoveWorktreeResponse,
  GitStatusFile,
  GitStatusRequest,
  GitStatusResponse,
  GitSwitchRefRequest,
  GitSwitchRefResponse,
  OpenInEditorRequest,
  OpenInEditorResponse,
  KeybindingsLoadResponse,
  KeybindingsSaveRequest,
  KeybindingsSaveResponse,
  PermissionResponseRequest,
  ProjectListSkillsRequest,
  ProjectListSkillsResponse,
  ProjectSkillEntry,
  ProjectSearchFilesRequest,
  ProjectSearchFilesResponse,
  ReadScriptsRequest,
  ReadScriptsResponse,
  SaveImageRequest,
  SaveImageResponse,
  SendPromptRequest,
  SendPromptResponse,
  UserInputQuestion,
  UserInputResponseRequest,
  WriteProjectFileRequest,
  WriteProjectFileResponse,
} from "@shared/chat";

const inflight = new Map<string, AbortController>();

// Active permission prompts. Keyed by `permId` (renderer-visible identifier),
// each entry holds the resolver that the SDK's canUseTool is awaiting plus
// the requestId so we can mass-resolve when a turn is cancelled.
type PermSlot = {
  resolve: (decision: "allow" | "deny") => void;
  requestId: string;
};
const pendingPerms = new Map<string, PermSlot>();
type UserInputSlot = {
  resolve: (response: Record<string, string[]> | "reject") => void;
  requestId: string;
  questions: UserInputQuestion[];
};
const pendingUserInputs = new Map<string, UserInputSlot>();

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // Reject messages from anything that isn't our main BrowserWindow's web
  // contents — iframes, webviews, or stray BrowserViews would otherwise be
  // able to invoke privileged channels by walking the same `window.api`
  // bridge. Today there are no such guests, but adding a regression here
  // (e.g. a hosted preview pane) shouldn't silently widen the attack surface.
  const fromMain = (event: IpcMainInvokeEvent): boolean => {
    const win = getWindow();
    return win !== null && event.sender === win.webContents;
  };
  const terminalManager = new TerminalManager(
    () => getWindow()?.webContents ?? null,
    isInsideAllowedRoot,
  );
  app.once("before-quit", () => terminalManager.closeAll());

  ipcMain.handle(
    IpcChannel.ChatSend,
    async (event, raw: SendPromptRequest): Promise<SendPromptResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      try {
        await validateSendRequest(raw);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const win = getWindow();
      if (!win) return { ok: false, error: "No active window" };

      const requestId = raw.requestId;
      // If a request with this id is somehow still in flight, abort it before
      // overwriting — defensive, shouldn't happen in normal use.
      const existing = inflight.get(requestId);
      if (existing) existing.abort();
      const controller = new AbortController();
      inflight.set(requestId, controller);

      const wc = win.webContents;
      const emit = (event: ChatEvent) => {
        if (wc.isDestroyed()) return;
        const env: ChatEventEnvelope = { threadId: raw.threadId, requestId, event };
        wc.send(IpcChannel.ChatEvent, env);
      };

      const requestPermission = raw.askBeforeTools && !raw.runConfig.fullAccess
        ? (toolName: string, input: Record<string, unknown>, toolUseId: string) =>
            new Promise<"allow" | "deny">((resolve) => {
              const permId = `perm-${requestId}-${toolUseId}`;
              pendingPerms.set(permId, { resolve, requestId });
              emit({
                kind: "permission_request",
                permId,
                toolUseId,
                toolName,
                input,
              });
            })
        : undefined;
      const requestUserInput = (
        userInputRequestId: string,
        questions: UserInputQuestion[],
      ) =>
        new Promise<Record<string, string[]> | "reject">((resolve) => {
          pendingUserInputs.set(userInputRequestId, {
            resolve,
            requestId,
            questions,
          });
        });

      runProvider(raw, controller.signal, emit, requestPermission, requestUserInput)
        .catch((err) => {
          emit({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          inflight.delete(requestId);
          // Auto-deny anything still pending for this run so the SDK isn't
          // left holding a promise after the run loop has unwound.
          for (const [permId, slot] of pendingPerms) {
            if (slot.requestId === requestId) {
              slot.resolve("deny");
              pendingPerms.delete(permId);
            }
          }
          for (const [userInputRequestId, slot] of pendingUserInputs) {
            if (slot.requestId === requestId) {
              slot.resolve("reject");
              pendingUserInputs.delete(userInputRequestId);
            }
          }
        });

      return { ok: true, requestId };
    },
  );

  ipcMain.handle(IpcChannel.ChatCancel, async (event, raw: CancelPromptRequest) => {
    if (!fromMain(event)) return;
    const ctrl = inflight.get(raw.requestId);
    if (ctrl) {
      ctrl.abort();
      inflight.delete(raw.requestId);
    }
    // Cancelling a run also clears any approvals it was waiting on — the SDK
    // won't act on them once aborted, but the renderer might have stale
    // cards otherwise. Resolving "deny" releases the canUseTool promise.
    for (const [permId, slot] of pendingPerms) {
      if (slot.requestId === raw.requestId) {
        slot.resolve("deny");
        pendingPerms.delete(permId);
      }
    }
    for (const [userInputRequestId, slot] of pendingUserInputs) {
      if (slot.requestId === raw.requestId) {
        slot.resolve("reject");
        pendingUserInputs.delete(userInputRequestId);
      }
    }
  });

  ipcMain.handle(
    IpcChannel.ChatPermissionResponse,
    async (event, req: PermissionResponseRequest) => {
      if (!fromMain(event)) return;
      if (!req || typeof req.permId !== "string") return;
      const slot = pendingPerms.get(req.permId);
      if (!slot) return;
      slot.resolve(req.decision === "allow" ? "allow" : "deny");
      pendingPerms.delete(req.permId);
    },
  );

  ipcMain.handle(
    IpcChannel.ChatUserInputResponse,
    async (event, req: UserInputResponseRequest) => {
      if (!fromMain(event)) return;
      if (!req || typeof req.requestId !== "string") return;
      const slot = pendingUserInputs.get(req.requestId);
      if (!slot) return;
      slot.resolve(req.reject ? "reject" : normalizeUserInputAnswers(req.answers, slot.questions));
      pendingUserInputs.delete(req.requestId);
    },
  );

  ipcMain.handle(IpcChannel.TerminalOpen, async (event, raw) => {
    if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
    return terminalManager.open(raw);
  });

  ipcMain.handle(IpcChannel.TerminalWrite, async (event, raw) => {
    if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
    return terminalManager.write(raw);
  });

  ipcMain.handle(IpcChannel.TerminalResize, async (event, raw) => {
    if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
    return terminalManager.resize(raw);
  });

  ipcMain.handle(IpcChannel.TerminalClear, async (event, raw) => {
    if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
    return terminalManager.clear(raw);
  });

  ipcMain.handle(IpcChannel.TerminalRestart, async (event, raw) => {
    if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
    return terminalManager.restart(raw);
  });

  ipcMain.handle(IpcChannel.TerminalClose, async (event, raw) => {
    if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
    return terminalManager.close(raw);
  });

  ipcMain.handle(IpcChannel.EnvGet, async (event): Promise<EnvironmentInfo> => {
    if (!fromMain(event)) {
      return {
        platform: platform(),
        homeDir: "",
        defaultCwd: "",
        appVersion: app.getVersion(),
        hasAnthropicEnvKey: false,
      };
    }
    return {
      platform: platform(),
      homeDir: homedir(),
      defaultCwd: homedir(),
      appVersion: app.getVersion(),
      hasAnthropicEnvKey: Boolean(process.env.ANTHROPIC_API_KEY),
    };
  });

  ipcMain.handle(
    IpcChannel.ProvidersList,
    async (event, raw?: ProviderCatalogRequest): Promise<ProviderCatalogResponse> => {
      if (!fromMain(event)) {
        return {
          ok: false,
          catalog: EMPTY_PROVIDER_CATALOG,
          error: "Unauthorized sender",
        };
      }
      const runtime = sanitizeProviderRuntime(raw?.runtime);
      const [opencodeCatalog, cursor] = await Promise.all([
        loadOpenCodeCatalog(raw?.cwd ?? process.cwd(), runtime.opencode),
        loadCursorCatalog(runtime.cursor),
      ]);
      const catalog = { ...opencodeCatalog, cursor };
      return { ok: true, catalog };
    },
  );

  ipcMain.handle(
    IpcChannel.DialogChooseDirectory,
    async (event): Promise<ChooseDirectoryResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      const win = getWindow();
      if (!win) return { ok: false, error: "No active window" };
      try {
        const result = await dialog.showOpenDialog(win, {
          title: "Choose project folder",
          properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, cancelled: true };
        }
        const picked = result.filePaths[0]!;
        // The user explicitly picked this folder — register it as an
        // authorized cwd root before returning so subsequent ChatSends with
        // this path pass validation.
        await addProjectRoot(picked);
        return { ok: true, path: picked };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.DialogChooseFiles,
    async (event, req?: ChooseFilesRequest): Promise<ChooseFilesResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      const win = getWindow();
      if (!win) return { ok: false, error: "No active window" };
      try {
        const properties: Array<"openFile" | "multiSelections"> = ["openFile"];
        if (req?.multi) properties.push("multiSelections");
        // defaultPath is renderer-supplied — drop it unless it points inside
        // a project root the user has already authorised. Otherwise a
        // compromised renderer could pop the dialog at ~/.ssh, %APPDATA%, etc.
        let defaultPath: string | undefined;
        if (typeof req?.defaultPath === "string" && req.defaultPath.length > 0) {
          if (await isInsideAllowedRoot(req.defaultPath)) {
            defaultPath = req.defaultPath;
          }
        }
        const result = await dialog.showOpenDialog(win, {
          title: "Pick files",
          properties,
          defaultPath,
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, cancelled: true };
        }
        return { ok: true, paths: result.filePaths };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(IpcChannel.ShellOpenPath, async (event, p: string) => {
    if (!fromMain(event)) return;
    if (typeof p !== "string" || p.length === 0) return;
    if (!(await isPathSafeToOpen(p))) {
      return;
    }
    await shell.openPath(p);
  });

  ipcMain.handle(
    IpcChannel.ShellOpenInEditor,
    async (event, req: OpenInEditorRequest): Promise<OpenInEditorResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req !== "object") {
        return { ok: false, error: "Invalid request" };
      }
      const command = typeof req.editorCommand === "string" ? req.editorCommand.trim() : "";
      const path = typeof req.path === "string" ? req.path.trim() : "";
      if (!command) return { ok: false, error: "No editor command configured" };
      if (!path) return { ok: false, error: "No path provided" };
      if (!(await isInsideAllowedRoot(path))) {
        return { ok: false, error: "Path is not inside an authorized project root" };
      }
      // Tokenise the command argv-style. We deliberately avoid a shell so the
      // editor binary and its flags can't be hijacked by metacharacters in
      // the project path. Quoted segments stay together so commands like
      // `"C:\\Program Files\\Microsoft VS Code\\Code.exe" --new-window` work.
      const argv = tokeniseCommand(command);
      if (argv.length === 0) return { ok: false, error: "Empty editor command" };
      const [bin, ...args] = argv;
      const binName = basename(bin).toLowerCase();
      if (!ALLOWED_EDITOR_BINARIES.has(binName)) {
        return {
          ok: false,
          error: `Editor "${binName}" is not allowed. Configure a supported editor (code, subl, idea, vim, …) in Settings.`,
        };
      }
      try {
        const child = spawn(bin, [...args, path], {
          detached: true,
          stdio: "ignore",
          // Windows GUI apps need shell:false + the call below; on Linux/mac
          // detached:true + unref lets the editor outlive the agent.
          windowsHide: false,
        });
        child.on("error", () => {
          /* swallow — error is reported through the rejected response above */
        });
        child.unref();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectReadScripts,
    async (event, req: ReadScriptsRequest): Promise<ReadScriptsResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      // The package.json read happens with main-process privileges, so the
      // path must already be one the user has authorized.
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        const pkgPath = join(req.projectPath, "package.json");
        const raw = await readFile(pkgPath, "utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          return {
            ok: false,
            error: `Invalid package.json: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        const scriptsRaw =
          parsed && typeof parsed === "object" && "scripts" in parsed
            ? (parsed as { scripts?: unknown }).scripts
            : null;
        const scripts: { name: string; command: string }[] = [];
        if (scriptsRaw && typeof scriptsRaw === "object") {
          for (const [name, command] of Object.entries(scriptsRaw)) {
            if (typeof command === "string") {
              scripts.push({ name, command });
            }
          }
        }
        scripts.sort((a, b) => a.name.localeCompare(b.name));
        const manager = await detectManager(req.projectPath);
        return { ok: true, manager, scripts };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return { ok: false, error: "No package.json in this project." };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectWriteFile,
    async (
      event,
      req: WriteProjectFileRequest,
    ): Promise<WriteProjectFileResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        typeof req.relativePath !== "string" ||
        req.relativePath.trim().length === 0 ||
        typeof req.contents !== "string"
      ) {
        return { ok: false, error: "Invalid write request" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      if (isUnsafeRelativePath(req.relativePath)) {
        return { ok: false, error: "Relative path must stay inside the project" };
      }
      const target = resolvePath(req.projectPath, req.relativePath);
      if (!(await isInsideAllowedRoot(target))) {
        return { ok: false, error: "Target path is not authorized" };
      }
      try {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, req.contents, "utf8");
        return { ok: true, path: target };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSearchFiles,
    async (
      event,
      req: ProjectSearchFilesRequest,
    ): Promise<ProjectSearchFilesResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await searchProjectFiles(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectListSkills,
    async (
      event,
      req?: ProjectListSkillsRequest,
    ): Promise<ProjectListSkillsResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      const projectPath = typeof req?.projectPath === "string" && req.projectPath.length > 0
        ? req.projectPath
        : undefined;
      if (projectPath && !(await isInsideAllowedRoot(projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return { ok: true, skills: await listProjectSkills(projectPath) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitStatus,
    async (event, req: GitStatusRequest): Promise<GitStatusResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      return readGitStatus(req.projectPath);
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitDiff,
    async (event, req: GitDiffRequest): Promise<GitDiffResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await readGitDiff(req.projectPath, req.filePath, req.ignoreWhitespace === true);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitListRefs,
    async (event, req: GitListRefsRequest): Promise<GitListRefsResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await readGitRefs(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitSwitchRef,
    async (event, req: GitSwitchRefRequest): Promise<GitSwitchRefResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        typeof req.refName !== "string" ||
        req.refName.trim().length === 0
      ) {
        return { ok: false, error: "Invalid ref switch request" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await switchGitRef(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitCreateRef,
    async (event, req: GitCreateRefRequest): Promise<GitCreateRefResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        typeof req.refName !== "string" ||
        req.refName.trim().length === 0
      ) {
        return { ok: false, error: "Invalid ref create request" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await createGitRef(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitCreateWorktree,
    async (event, req: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await createGitWorktree(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitRemoveWorktree,
    async (event, req: GitRemoveWorktreeRequest): Promise<GitRemoveWorktreeResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        typeof req.worktreePath !== "string" ||
        req.worktreePath.length === 0
      ) {
        return { ok: false, error: "Invalid worktree request" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      if (!(await isInsideAllowedRoot(req.worktreePath))) {
        return { ok: false, error: "Worktree path is not authorized" };
      }
      try {
        return await removeGitWorktree(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSourceControlScan,
    async (event, req?: SourceControlScanRequest): Promise<SourceControlScanResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      const projectPath =
        req && typeof req.projectPath === "string" && req.projectPath.length > 0
          ? req.projectPath
          : undefined;
      if (projectPath && !(await isInsideAllowedRoot(projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await scanSourceControl(projectPath);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectGitClone,
    async (event, req: GitCloneRequest): Promise<GitCloneResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req !== "object") return { ok: false, error: "Invalid request" };
      const hasRepositoryUrl =
        typeof req.repositoryUrl === "string" && req.repositoryUrl.trim().length > 0;
      const hasProviderRepository =
        typeof req.provider === "string" &&
        typeof req.repository === "string" &&
        req.repository.trim().length > 0;
      if (
        (!hasRepositoryUrl && !hasProviderRepository) ||
        typeof req.destinationParentPath !== "string" ||
        req.destinationParentPath.length === 0
      ) {
        return { ok: false, error: "Repository source and destination folder are required" };
      }
      if (!(await isInsideAllowedRoot(req.destinationParentPath))) {
        return { ok: false, error: "Destination folder is not authorized" };
      }
      try {
        return await cloneGitRepository(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSourceControlListChangeRequests,
    async (
      event,
      req: SourceControlListChangeRequestsRequest,
    ): Promise<SourceControlListChangeRequestsResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.projectPath !== "string" || req.projectPath.length === 0) {
        return { ok: false, error: "Invalid project path" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await listSourceControlChangeRequests(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSourceControlOpenChangeRequest,
    async (
      event,
      req: SourceControlOpenChangeRequestRequest,
    ): Promise<SourceControlOpenChangeRequestResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        typeof req.url !== "string" ||
        req.url.length === 0
      ) {
        return { ok: false, error: "Invalid change request link" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        const remotes = await readSourceControlRemotes(req.projectPath);
        if (!isAllowedChangeRequestUrl(req.url, remotes)) {
          return { ok: false, error: "Change request link does not match this repository remote" };
        }
        await shell.openExternal(req.url);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSourceControlCheckoutChangeRequest,
    async (
      event,
      req: SourceControlCheckoutChangeRequestRequest,
    ): Promise<SourceControlCheckoutChangeRequestResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        (req.provider !== "github" &&
          req.provider !== "gitlab" &&
          req.provider !== "bitbucket" &&
          req.provider !== "azure-devops") ||
        typeof req.number !== "number" ||
        !Number.isInteger(req.number) ||
        req.number <= 0
      ) {
        return { ok: false, error: "Invalid change request checkout" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await checkoutSourceControlChangeRequest(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSourceControlCreateChangeRequest,
    async (
      event,
      req: SourceControlCreateChangeRequestRequest,
    ): Promise<SourceControlCreateChangeRequestResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        (req.provider !== "github" &&
          req.provider !== "gitlab" &&
          req.provider !== "bitbucket" &&
          req.provider !== "azure-devops") ||
        typeof req.title !== "string" ||
        req.title.trim().length === 0 ||
        (req.body != null && typeof req.body !== "string") ||
        (req.baseRefName != null && typeof req.baseRefName !== "string") ||
        (req.push != null && typeof req.push !== "boolean")
      ) {
        return { ok: false, error: "Invalid change request create" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await createSourceControlChangeRequest(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectSourceControlPublishRepository,
    async (
      event,
      req: SourceControlPublishRepositoryRequest,
    ): Promise<SourceControlPublishRepositoryResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (
        !req ||
        typeof req.projectPath !== "string" ||
        req.projectPath.length === 0 ||
        (req.provider !== "github" &&
          req.provider !== "gitlab" &&
          req.provider !== "bitbucket" &&
          req.provider !== "azure-devops") ||
        typeof req.repository !== "string" ||
        req.repository.trim().length === 0 ||
        (req.visibility !== "private" && req.visibility !== "public") ||
        (req.remoteName != null && typeof req.remoteName !== "string") ||
        (req.protocol != null && req.protocol !== "auto" && req.protocol !== "ssh" && req.protocol !== "https")
      ) {
        return { ok: false, error: "Invalid repository publish request" };
      }
      if (!(await isInsideAllowedRoot(req.projectPath))) {
        return { ok: false, error: "Project path is not authorized" };
      }
      try {
        return await publishSourceControlRepository(req);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.KeybindingsLoad,
    async (event): Promise<KeybindingsLoadResponse> => {
      if (!fromMain(event)) {
        return { ok: false, error: "Unauthorized sender", path: "" };
      }
      const path = keybindingsPath();
      try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return { ok: true, overrides: {}, rules: sanitizeKeybindingRules(parsed), path };
        }
        const overrides = sanitizeOverrides(parsed);
        return { ok: true, overrides, rules: [], path };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          // First-time use — return empty overrides without surfacing as an
          // error to the renderer.
          return { ok: true, overrides: {}, rules: [], path };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          path,
        };
      }
    },
  );

  ipcMain.handle(
    IpcChannel.KeybindingsSave,
    async (event, req: KeybindingsSaveRequest): Promise<KeybindingsSaveResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      const path = keybindingsPath();
      try {
        await mkdir(app.getPath("userData"), { recursive: true });
        if (Array.isArray(req?.rules)) {
          const rules = sanitizeKeybindingRules(req.rules);
          await writeFile(path, JSON.stringify(rules, null, 2) + "\n", "utf8");
        } else {
          const overrides = sanitizeOverrides(req?.overrides ?? {});
          await writeFile(path, JSON.stringify(overrides, null, 2) + "\n", "utf8");
        }
        return { ok: true, path };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(IpcChannel.KeybindingsRevealFile, async (event) => {
    if (!fromMain(event)) return;
    const path = keybindingsPath();
    try {
      await access(path);
    } catch {
      // Create an empty config so the user has something to edit.
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(path, "[]\n", "utf8");
    }
    await shell.openPath(path);
  });

  ipcMain.handle(IpcChannel.ProjectsBootstrap, async (event, paths: unknown) => {
    if (!fromMain(event)) return;
    if (!Array.isArray(paths)) return;
    const filtered = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
    await bootstrapAllowlist(filtered);
  });

  ipcMain.handle(
    IpcChannel.AttachmentsSaveImage,
    async (event, req: SaveImageRequest): Promise<SaveImageResponse> => {
      if (!fromMain(event)) return { ok: false, error: "Unauthorized sender" };
      if (!req || typeof req.base64 !== "string" || req.base64.length === 0) {
        return { ok: false, error: "Empty image payload" };
      }
      const ext = sanitizeExtension(req.extension);
      try {
        const dir = join(app.getPath("userData"), "attachments");
        await mkdir(dir, { recursive: true });
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const filePath = join(dir, `${id}.${ext}`);
        const buf = Buffer.from(req.base64, "base64");
        await writeFile(filePath, buf);
        return { ok: true, path: filePath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  registerWindowHandlers(getWindow);
}

function keybindingsPath(): string {
  return join(app.getPath("userData"), "keybindings.json");
}

function sanitizeOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0) continue;
    if (typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

const KEYBINDING_COMMANDS = new Set<string>([
  "settings.toggle",
  "shortcuts.open",
  "commandPalette.toggle",
  "chat.new",
  "chat.stop",
  "chat.archive",
  "sidebar.toggle",
  "thread.previous",
  "thread.next",
  "lock.toggle",
  "diff.toggle",
  "terminal.toggle",
  "terminal.new",
  "terminal.split",
  "terminal.close",
  "tasks.toggle",
  "plan.toggle",
  "modelPicker.toggle",
]);

function sanitizeKeybindingRules(
  raw: unknown,
): { key: string; command: string; when?: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { key: string; command: string; when?: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { key?: unknown; command?: unknown; when?: unknown };
    if (typeof entry.key !== "string" || entry.key.trim().length === 0) continue;
    if (typeof entry.command !== "string" || !KEYBINDING_COMMANDS.has(entry.command)) continue;
    const when =
      typeof entry.when === "string" && entry.when.trim().length > 0
        ? entry.when.trim()
        : undefined;
    out.push({
      key: entry.key.trim(),
      command: entry.command,
      ...(when ? { when } : {}),
    });
  }
  return out;
}

function sanitizeExtension(raw: string | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "png";
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.length === 0 || cleaned.length > 8) return "png";
  return cleaned;
}

async function detectManager(
  projectPath: string,
): Promise<"bun" | "npm" | "pnpm" | "yarn"> {
  const checks: Array<{ file: string; manager: "bun" | "npm" | "pnpm" | "yarn" }> = [
    { file: "bun.lock", manager: "bun" },
    { file: "bun.lockb", manager: "bun" },
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "package-lock.json", manager: "npm" },
  ];
  for (const c of checks) {
    try {
      await access(join(projectPath, c.file));
      return c.manager;
    } catch {
      // try next
    }
  }
  return "npm";
}

const FILE_SEARCH_DEFAULT_LIMIT = 40;
const FILE_SEARCH_MAX_LIMIT = 100;
const FILE_SEARCH_FALLBACK_VISIT_CAP = 8_000;
const FILE_SEARCH_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
]);

async function searchProjectFiles(
  req: ProjectSearchFilesRequest,
): Promise<ProjectSearchFilesResponse> {
  const query = typeof req.query === "string" ? req.query.trim().replace(/\\/g, "/") : "";
  const limit = clampFileSearchLimit(req.limit);
  const fromGit = await gitTrackedAndUntrackedFiles(req.projectPath);
  const source = fromGit ?? (await fallbackProjectFiles(req.projectPath, query, limit));
  const filtered = rankProjectFiles(source, query);
  return {
    ok: true,
    entries: filtered.slice(0, limit).map((path) => ({ path })),
    totalCount: filtered.length,
  };
}

const SKILL_SCAN_MAX_DEPTH = 7;
const SKILL_SCAN_VISIT_CAP = 5_000;
const SKILL_RESULT_CAP = 600;
const SKILL_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
]);

async function listProjectSkills(projectPath?: string): Promise<ProjectSkillEntry[]> {
  const roots = skillRoots(projectPath);
  const found: ProjectSkillEntry[] = [];
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    const next = await scanSkillRoot(root.path, root.scope, projectPath);
    found.push(...next);
    if (found.length >= SKILL_RESULT_CAP) break;
  }
  return dedupeSkills(found)
    .sort((a, b) => skillScopeRank(a.scope) - skillScopeRank(b.scope) || a.displayName.localeCompare(b.displayName))
    .slice(0, SKILL_RESULT_CAP);
}

function skillRoots(projectPath?: string): { path: string; scope: ProjectSkillEntry["scope"] }[] {
  const home = homedir();
  const roots: { path: string; scope: ProjectSkillEntry["scope"] }[] = [];
  if (projectPath) {
    roots.push(
      { path: join(projectPath, ".codex", "skills"), scope: "project" },
      { path: join(projectPath, ".agents", "skills"), scope: "project" },
    );
  }
  roots.push(
    { path: join(home, ".codex", "skills"), scope: "personal" },
    { path: join(home, ".agents", "skills"), scope: "personal" },
    { path: join(home, ".codex", "plugins", "cache"), scope: "app" },
    { path: join(home, ".agents", "plugins", "cache"), scope: "app" },
  );
  return roots;
}

async function scanSkillRoot(
  root: string,
  defaultScope: ProjectSkillEntry["scope"],
  projectPath?: string,
): Promise<ProjectSkillEntry[]> {
  const skills: ProjectSkillEntry[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < SKILL_SCAN_VISIT_CAP && skills.length < SKILL_RESULT_CAP) {
    const current = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      const parsed = await readSkillFile(join(current.dir, "SKILL.md"), current.dir, defaultScope, projectPath);
      if (parsed) skills.push(parsed);
      continue;
    }

    if (current.depth >= SKILL_SCAN_MAX_DEPTH) continue;
    entries
      .filter((entry) => entry.isDirectory() && !SKILL_SKIP_DIRS.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 }));
  }

  return skills;
}

async function readSkillFile(
  skillPath: string,
  skillDir: string,
  defaultScope: ProjectSkillEntry["scope"],
  projectPath?: string,
): Promise<ProjectSkillEntry | null> {
  let raw: string;
  try {
    raw = await readFile(skillPath, "utf8");
  } catch {
    return null;
  }
  const meta = parseSkillFrontmatter(raw);
  const fallbackName = basename(skillDir);
  const name = sanitizeSkillName(meta.name) || sanitizeSkillName(fallbackName);
  if (!name) return null;
  const description = cleanFrontmatterValue(meta.description);
  const shortDescription = description ? truncateSingleLine(description, 120) : undefined;
  return {
    name,
    displayName: titleCaseSkillName(name),
    ...(description ? { description } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    scope: resolveSkillScope(skillPath, defaultScope, projectPath),
    path: skillPath,
  };
}

function parseSkillFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(3, end).split(/\r?\n/);
  const out: Record<string, string> = {};
  for (const line of block) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]!.toLowerCase()] = cleanFrontmatterValue(match[2] ?? "");
  }
  return out;
}

function cleanFrontmatterValue(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
}

function sanitizeSkillName(value: string | undefined): string {
  const cleaned = cleanFrontmatterValue(value);
  return /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,120}$/.test(cleaned) ? cleaned : "";
}

function titleCaseSkillName(value: string): string {
  return value
    .split(/[\s:_./-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateSingleLine(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function resolveSkillScope(
  skillPath: string,
  defaultScope: ProjectSkillEntry["scope"],
  projectPath?: string,
): ProjectSkillEntry["scope"] {
  const normalized = skillPath.replace(/\\/g, "/").toLowerCase();
  if (projectPath) {
    const project = resolvePath(projectPath).replace(/\\/g, "/").toLowerCase();
    if (normalized.startsWith(project + "/")) return "project";
  }
  if (normalized.includes("/.system/")) return "system";
  if (normalized.includes("/.codex/plugins/") || normalized.includes("/.agents/plugins/")) return "app";
  return defaultScope;
}

function dedupeSkills(skills: ProjectSkillEntry[]): ProjectSkillEntry[] {
  const byName = new Map<string, ProjectSkillEntry>();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || skillScopeRank(skill.scope) < skillScopeRank(prev.scope)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

function skillScopeRank(scope: ProjectSkillEntry["scope"]): number {
  switch (scope) {
    case "project":
      return 0;
    case "personal":
      return 1;
    case "app":
      return 2;
    case "system":
      return 3;
  }
}

async function gitTrackedAndUntrackedFiles(projectPath: string): Promise<string[] | null> {
  const repoCheck = await runProcess("git", [
    "-C",
    projectPath,
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (repoCheck.code !== 0 || repoCheck.stdout.trim() !== "true") return null;

  const result = await runProcess("git", [
    "-C",
    projectPath,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (result.code !== 0) return null;
  return uniqueRelativeFilePaths(result.stdout.split(/\r?\n/));
}

async function fallbackProjectFiles(
  projectPath: string,
  query: string,
  limit: number,
): Promise<string[]> {
  const root = resolvePath(projectPath);
  const out: string[] = [];
  const stack = [""];
  let visited = 0;

  while (stack.length > 0 && visited < FILE_SEARCH_FALLBACK_VISIT_CAP) {
    const relDir = stack.shift()!;
    const absDir = relDir ? join(root, relDir) : root;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      visited += 1;
      if (visited >= FILE_SEARCH_FALLBACK_VISIT_CAP) break;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!FILE_SEARCH_SKIP_DIRS.has(entry.name)) stack.push(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const normalized = relPath.replace(/\\/g, "/");
      if (!query || projectFileMatches(normalized, query)) out.push(normalized);
      if (!query && out.length >= limit) return out;
    }
  }

  return uniqueRelativeFilePaths(out);
}

function rankProjectFiles(paths: string[], query: string): string[] {
  const q = query.toLowerCase();
  const filtered = !q ? paths : paths.filter((path) => projectFileMatches(path, q));
  return filtered.sort((a, b) => {
    const scoreDelta = fileSearchScore(b, q) - fileSearchScore(a, q);
    if (scoreDelta !== 0) return scoreDelta;
    return a.localeCompare(b);
  });
}

function projectFileMatches(path: string, query: string): boolean {
  if (!query) return true;
  return path.toLowerCase().includes(query.toLowerCase());
}

function fileSearchScore(path: string, query: string): number {
  if (!query) return 0;
  const lower = path.toLowerCase();
  const base = basename(path).toLowerCase();
  if (lower === query) return 100;
  if (base === query) return 90;
  if (lower.startsWith(query)) return 80;
  if (base.startsWith(query)) return 70;
  if (lower.includes(`/${query}`)) return 50;
  if (lower.includes(query)) return 30;
  return 0;
}

function uniqueRelativeFilePaths(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const path = raw.trim().replace(/\\/g, "/");
    if (!path || path.includes("\0") || isUnsafeRelativePath(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function clampFileSearchLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return FILE_SEARCH_DEFAULT_LIMIT;
  return Math.min(FILE_SEARCH_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function registerWindowHandlers(getWindow: () => BrowserWindow | null): void {
  const fromMain = (event: IpcMainInvokeEvent): boolean => {
    const win = getWindow();
    return win !== null && event.sender === win.webContents;
  };

  ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
    if (!fromMain(event)) return;
    getWindow()?.minimize();
  });

  ipcMain.handle(IpcChannel.WindowMaximize, (event) => {
    if (!fromMain(event)) return;
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IpcChannel.WindowClose, (event) => {
    if (!fromMain(event)) return;
    getWindow()?.close();
  });

  ipcMain.handle(IpcChannel.WindowIsMaximized, (event): boolean => {
    if (!fromMain(event)) return false;
    return getWindow()?.isMaximized() ?? false;
  });
}

export function broadcastMaximizeChange(wc: WebContents, isMax: boolean): void {
  if (wc.isDestroyed()) return;
  wc.send(IpcChannel.WindowMaximizeChange, isMax);
}

// Whitelist of binary basenames we'll let the renderer-supplied editorCommand
// invoke. The Settings UI is renderer-controlled, so without this allowlist a
// compromised renderer could set editorCommand to `cmd /c <evil>` (or `sh -c`
// on POSIX) and any "Open in Editor" click would pipe an authorised file path
// into an attacker-controlled shell. Spawn doesn't go through a shell, but
// the *first token* IS the executable — making `cmd` itself the shell. We
// match by basename (case-insensitive) so absolute paths to the editor still
// work; users with editors not on this list need to add them here.
const ALLOWED_EDITOR_BINARIES = new Set([
  // VS Code family
  "code",
  "code.exe",
  "code-insiders",
  "code-insiders.exe",
  "codium",
  "codium.exe",
  "vscodium",
  "vscodium.exe",
  // Cursor / Windsurf (AI forks of VS Code)
  "cursor",
  "cursor.exe",
  "windsurf",
  "windsurf.exe",
  // Sublime Text
  "subl",
  "subl.exe",
  "sublime_text",
  "sublime_text.exe",
  // JetBrains
  "idea",
  "idea.exe",
  "idea64.exe",
  "webstorm",
  "webstorm.exe",
  "webstorm64.exe",
  "pycharm",
  "pycharm.exe",
  "pycharm64.exe",
  "phpstorm",
  "phpstorm.exe",
  "phpstorm64.exe",
  "rubymine",
  "rubymine.exe",
  "rubymine64.exe",
  "goland",
  "goland.exe",
  "goland64.exe",
  "rider",
  "rider.exe",
  "rider64.exe",
  "clion",
  "clion.exe",
  "clion64.exe",
  "fleet",
  "fleet.exe",
  // Vim / Neovim
  "vim",
  "vim.exe",
  "gvim",
  "gvim.exe",
  "nvim",
  "nvim.exe",
  "nvim-qt",
  "nvim-qt.exe",
  // Emacs
  "emacs",
  "emacs.exe",
  "runemacs.exe",
  // Atom (legacy)
  "atom",
  "atom.exe",
  // Notepad++
  "notepad++",
  "notepad++.exe",
  // Zed
  "zed",
  "zed.exe",
  // mac-only convenience wrappers
  "mate",
  "bbedit",
]);

// File extensions we refuse to hand to `shell.openPath` even when the path
// itself is inside an allowed root. Opening these is execution on Windows
// (and shell scripts on POSIX), and our model output / agent traces should
// never need to surface them — if a user really wants to run a script,
// they can launch it from their own terminal.
const EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".scr",
  ".msi",
  ".msp",
  ".jar",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".command",
  ".app",
]);

async function isPathSafeToOpen(p: string): Promise<boolean> {
  // Reject paths whose resolved form escapes every authorized project root.
  // path.resolve folds `..`, so attempts like `<root>/../../etc/passwd`
  // collapse to `/etc/passwd` before the prefix check.
  const resolved = resolvePath(p);
  if (!(await isInsideAllowedRoot(resolved))) return false;
  const ext = extname(resolved).toLowerCase();
  if (EXECUTABLE_EXTENSIONS.has(ext)) return false;
  return true;
}

function tokeniseCommand(input: string): string[] {
  // Minimal POSIX-ish tokeniser: respects double and single quotes so paths
  // with spaces survive, but doesn't expand env vars or globs (we don't run
  // through a shell).
  const tokens: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) tokens.push(buf);
  return tokens;
}

async function readGitStatus(projectPath: string): Promise<GitStatusResponse> {
  const result = await runProcess("git", ["-C", projectPath, "status", "--porcelain=v1", "-b"]);
  if (result.code !== 0) {
    const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
    if (
      text.includes("not a git repository") ||
      text.includes("not a git command") ||
      text.includes("cannot change to")
    ) {
      return { ok: true, isRepo: false };
    }
    return {
      ok: false,
      error: (result.stderr || result.stdout || `git exited with code ${result.code}`).trim(),
    };
  }

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  const branchInfo = parseBranchHeader(header);
  const files = lines.map(parseGitStatusLine).filter((f): f is GitStatusFile => f !== null);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;

  for (const file of files) {
    if (file.index === "?" && file.worktree === "?") {
      untracked += 1;
      continue;
    }
    if (isConflictStatus(file.index, file.worktree)) conflicted += 1;
    if (file.index !== " " && file.index !== "?") staged += 1;
    if (file.worktree !== " " && file.worktree !== "?") unstaged += 1;
  }

  return {
    ok: true,
    isRepo: true,
    ...branchInfo,
    staged,
    unstaged,
    untracked,
    conflicted,
    files,
  };
}

async function readGitDiff(
  projectPath: string,
  filePath: string | undefined,
  ignoreWhitespace: boolean,
): Promise<GitDiffResponse> {
  const pathArgs = filePath ? await gitDiffPathArgs(projectPath, filePath) : [];
  const whitespaceArgs = ignoreWhitespace ? ["--ignore-all-space"] : [];
  const unstaged = await runProcess("git", [
    "-C",
    projectPath,
    "diff",
    "--no-ext-diff",
    ...whitespaceArgs,
    "--",
    ...pathArgs,
  ]);
  if (unstaged.code !== 0) {
    return gitProcessError("git diff", unstaged);
  }

  const staged = await runProcess("git", [
    "-C",
    projectPath,
    "diff",
    "--cached",
    "--no-ext-diff",
    ...whitespaceArgs,
    "--",
    ...pathArgs,
  ]);
  if (staged.code !== 0) {
    return gitProcessError("git diff --cached", staged);
  }

  if (unstaged.stdout || staged.stdout) {
    return {
      ok: true,
      diff: [staged.stdout.trimEnd(), unstaged.stdout.trimEnd()]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  if (!filePath) return { ok: true, diff: "" };

  const untracked = await runProcess("git", [
    "-C",
    projectPath,
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...pathArgs,
  ]);
  if (untracked.code !== 0) {
    return gitProcessError("git ls-files", untracked);
  }
  if (untracked.stdout.trim().length === 0) return { ok: true, diff: "" };

  const noIndex = await runProcess("git", [
    "-C",
    projectPath,
    "diff",
    "--no-ext-diff",
    ...whitespaceArgs,
    "--no-index",
    "--",
    nulDevicePath(),
    ...pathArgs,
  ]);
  // `git diff --no-index` exits 1 when it successfully finds differences.
  if (noIndex.code !== 0 && noIndex.code !== 1) {
    return gitProcessError("git diff --no-index", noIndex);
  }
  return { ok: true, diff: normalizeNoIndexDiff(noIndex.stdout, filePath) };
}

async function gitDiffPathArgs(projectPath: string, filePath: string): Promise<string[]> {
  if (filePath.length === 0 || filePath.includes("\0")) {
    throw new Error("Invalid git file path");
  }
  if (filePath.includes("\\") || filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath)) {
    throw new Error("Git file path must be relative to the project");
  }
  const root = resolvePath(projectPath);
  const target = resolvePath(root, filePath);
  const relative = target.slice(root.length).replace(/^[\\/]+/, "");
  if (!target.startsWith(root + "\\") && !target.startsWith(root + "/")) {
    throw new Error("Git file path escapes the project");
  }
  return [relative.replace(/\\/g, "/")];
}

function gitProcessError(
  operation: string,
  result: { code: number; stdout: string; stderr: string },
): GitDiffResponse {
  return {
    ok: false,
    error: (result.stderr || result.stdout || `${operation} exited with code ${result.code}`).trim(),
  };
}

function nulDevicePath(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function normalizeNoIndexDiff(diff: string, filePath: string): string {
  return diff
    .replace(/^diff --git a\/NUL b\/.+$/m, `diff --git a/${filePath} b/${filePath}`)
    .replace(/^--- a\/NUL$/m, "--- /dev/null")
    .replace(/^--- NUL$/m, "--- /dev/null")
    .replace(/^\+\+\+ b\/.+$/m, `+++ b/${filePath}`);
}

async function readGitRefs(req: GitListRefsRequest): Promise<GitListRefsResponse> {
  const repoCheck = await runProcess("git", [
    "-C",
    req.projectPath,
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (repoCheck.code !== 0 || repoCheck.stdout.trim() !== "true") {
    const text = `${repoCheck.stderr}\n${repoCheck.stdout}`.toLowerCase();
    if (
      text.includes("not a git repository") ||
      text.includes("cannot change to") ||
      text.includes("not a git command")
    ) {
      return { ok: true, isRepo: false };
    }
    return gitRefsError("git rev-parse", repoCheck);
  }

  const [refsResult, currentResult, defaultResult, worktreesResult] = await Promise.all([
    runProcess("git", [
      "-C",
      req.projectPath,
      "for-each-ref",
      "--format=%(refname:short)%00%(refname)%00%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ]),
    runProcess("git", ["-C", req.projectPath, "branch", "--show-current"]),
    runProcess("git", [
      "-C",
      req.projectPath,
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]),
    runProcess("git", ["-C", req.projectPath, "worktree", "list", "--porcelain"]),
  ]);
  if (refsResult.code !== 0) return gitRefsError("git for-each-ref", refsResult);

  const currentBranch = currentResult.code === 0 ? currentResult.stdout.trim() : "";
  const defaultRemote = defaultResult.code === 0 ? defaultResult.stdout.trim() : "";
  const defaultLocal = defaultRemote.startsWith("origin/")
    ? defaultRemote.slice("origin/".length)
    : defaultRemote;
  const worktreeByBranch = worktreesResult.code === 0
    ? parseWorktreeBranchPaths(worktreesResult.stdout)
    : new Map<string, string>();
  const localNames = new Set<string>();

  for (const line of refsResult.stdout.split(/\r?\n/)) {
    const [, fullName] = line.split("\0");
    if (fullName?.startsWith("refs/heads/")) {
      localNames.add(fullName.slice("refs/heads/".length));
    }
  }

  const refs: GitRef[] = [];
  for (const line of refsResult.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const [shortName, fullName, headMark] = line.split("\0");
    if (!shortName || !fullName) continue;
    if (shortName.endsWith("/HEAD") || /\/HEAD$/.test(fullName)) continue;

    const isRemote = fullName.startsWith("refs/remotes/");
    if (isRemote && shortName.startsWith("origin/")) {
      const localCandidate = shortName.slice("origin/".length);
      if (localNames.has(localCandidate)) continue;
    }

    const localBranchName = fullName.startsWith("refs/heads/")
      ? fullName.slice("refs/heads/".length)
      : "";
    refs.push({
      name: shortName,
      isRemote,
      current: headMark === "*" || (!isRemote && shortName === currentBranch),
      isDefault:
        shortName === defaultRemote ||
        (!isRemote && defaultLocal.length > 0 && shortName === defaultLocal),
      worktreePath: localBranchName ? (worktreeByBranch.get(localBranchName) ?? null) : null,
    });
  }

  refs.sort(compareGitRefs);
  const query = typeof req.query === "string" ? req.query.trim().toLowerCase() : "";
  const filtered = query
    ? refs.filter((ref) => ref.name.toLowerCase().includes(query))
    : refs;
  const limit = clampGitRefLimit(req.limit);
  return {
    ok: true,
    isRepo: true,
    refs: filtered.slice(0, limit),
    totalCount: filtered.length,
  };
}

function parseWorktreeBranchPaths(output: string): Map<string, string> {
  const result = new Map<string, string>();
  let currentPath: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim() || null;
      continue;
    }
    if (line.startsWith("branch refs/heads/") && currentPath) {
      result.set(line.slice("branch refs/heads/".length).trim(), currentPath);
    }
  }
  return result;
}

function parseWorktreePaths(output: string): string[] {
  const result: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      const path = line.slice("worktree ".length).trim();
      if (path) result.push(path);
    }
  }
  return result;
}

function compareGitRefs(a: GitRef, b: GitRef): number {
  if (a.current !== b.current) return a.current ? -1 : 1;
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function clampGitRefLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 200;
  return Math.min(200, Math.max(1, Math.trunc(limit)));
}

function gitRefsError(
  operation: string,
  result: { code: number; stdout: string; stderr: string },
): GitListRefsResponse {
  return {
    ok: false,
    error: (result.stderr || result.stdout || `${operation} exited with code ${result.code}`).trim(),
  };
}

async function switchGitRef(req: GitSwitchRefRequest): Promise<GitSwitchRefResponse> {
  const refName = req.refName.trim();
  if (!refName) return { ok: false, error: "Ref name is required" };

  const refs = await readGitRefs({ projectPath: req.projectPath, limit: 200 });
  if (!refs.ok) return { ok: false, error: refs.error };
  if (!refs.isRepo) return { ok: false, error: "Project is not a git repository" };

  const selected = refs.refs.find((ref) => ref.name === refName);
  if (!selected) return { ok: false, error: `Unknown ref: ${refName}` };
  if (selected.worktreePath && resolvePath(selected.worktreePath) !== resolvePath(req.projectPath)) {
    return { ok: false, error: "Ref is already checked out in another worktree" };
  }

  const args = ["-C", req.projectPath, "switch"];
  if (selected.isRemote) {
    const localName = deriveLocalRefName(refName);
    const localExists = refs.refs.some((ref) => !ref.isRemote && ref.name === localName);
    if (!localExists) {
      args.push("--track", refName);
    } else {
      args.push(localName);
    }
  } else {
    args.push(refName);
  }

  const result = await runProcess("git", args);
  if (result.code !== 0) {
    return gitSwitchRefError("Failed to switch ref", result);
  }
  return { ok: true, refName: await currentGitBranch(req.projectPath) };
}

async function createGitRef(req: GitCreateRefRequest): Promise<GitCreateRefResponse> {
  const refName = req.refName.trim();
  if (!refName) return { ok: false, error: "Ref name is required" };

  const refCheck = await runProcess("git", ["check-ref-format", "--branch", refName]);
  if (refCheck.code !== 0) return gitCreateRefError("Invalid ref name", refCheck);

  const exists = await runProcess("git", ["-C", req.projectPath, "show-ref", "--verify", "--quiet", `refs/heads/${refName}`]);
  if (exists.code === 0) return { ok: false, error: `Ref already exists: ${refName}` };

  const args = ["-C", req.projectPath, req.switchRef ? "switch" : "branch"];
  if (req.switchRef) args.push("-c", refName);
  else args.push(refName);
  const result = await runProcess("git", args);
  if (result.code !== 0) return gitCreateRefError("Failed to create ref", result);
  return { ok: true, refName: req.switchRef ? (await currentGitBranch(req.projectPath)) ?? refName : refName };
}

async function currentGitBranch(projectPath: string): Promise<string | null> {
  const result = await runProcess("git", ["-C", projectPath, "branch", "--show-current"]);
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

function deriveLocalRefName(refName: string): string {
  const firstSlash = refName.indexOf("/");
  if (firstSlash <= 0 || firstSlash === refName.length - 1) return refName;
  return refName.slice(firstSlash + 1);
}

function gitSwitchRefError(
  prefix: string,
  result: { code: number; stdout: string; stderr: string },
): GitSwitchRefResponse {
  const detail = (result.stderr || result.stdout || `git exited with code ${result.code}`).trim();
  return { ok: false, error: detail ? `${prefix}: ${detail}` : prefix };
}

function gitCreateRefError(
  prefix: string,
  result: { code: number; stdout: string; stderr: string },
): GitCreateRefResponse {
  const detail = (result.stderr || result.stdout || `git exited with code ${result.code}`).trim();
  return { ok: false, error: detail ? `${prefix}: ${detail}` : prefix };
}

async function createGitWorktree(
  req: GitCreateWorktreeRequest,
): Promise<GitCreateWorktreeResponse> {
  const branchName = req.branchName.trim();
  if (!branchName) return { ok: false, error: "Branch name is required" };

  const refCheck = await runProcess("git", ["check-ref-format", "--branch", branchName]);
  if (refCheck.code !== 0) {
    return gitWorktreeError("Invalid branch name", refCheck);
  }

  const rootResult = await runProcess("git", ["-C", req.projectPath, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0) {
    return gitWorktreeError("Unable to resolve repository root", rootResult);
  }

  const repoRoot = rootResult.stdout.trim();
  if (!repoRoot) return { ok: false, error: "Unable to resolve repository root" };
  const worktreesRoot = join(dirname(repoRoot), `${basename(repoRoot)}.worktrees`);
  await mkdir(worktreesRoot, { recursive: true });
  const worktreePath = await nextAvailablePath(
    worktreesRoot,
    safeWorktreeDirectoryName(branchName),
  );
  const startPoint = typeof req.startPoint === "string" && req.startPoint.trim()
    ? req.startPoint.trim()
    : "HEAD";

  const result = await runProcess("git", [
    "-C",
    req.projectPath,
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    startPoint,
  ]);
  if (result.code !== 0) {
    return gitWorktreeError("Failed to create worktree", result);
  }

  await addProjectRoot(worktreePath);
  return { ok: true, branchName, worktreePath };
}

async function removeGitWorktree(
  req: GitRemoveWorktreeRequest,
): Promise<GitRemoveWorktreeResponse> {
  const projectPath = resolvePath(req.projectPath);
  const worktreePath = resolvePath(req.worktreePath);
  if (projectPath === worktreePath) {
    return { ok: false, error: "Refusing to remove the project root" };
  }

  const rootResult = await runProcess("git", ["-C", projectPath, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0) {
    return gitRemoveWorktreeError("Unable to resolve repository root", rootResult);
  }
  const repoRoot = resolvePath(rootResult.stdout.trim());
  if (repoRoot === worktreePath) {
    return { ok: false, error: "Refusing to remove the main repository worktree" };
  }

  const listed = await runProcess("git", ["-C", projectPath, "worktree", "list", "--porcelain"]);
  if (listed.code !== 0) {
    return gitRemoveWorktreeError("Unable to list worktrees", listed);
  }
  const known = parseWorktreePaths(listed.stdout).some((path) => resolvePath(path) === worktreePath);
  if (!known) {
    return { ok: false, error: "Worktree is not registered in this repository" };
  }

  const args = ["-C", projectPath, "worktree", "remove"];
  if (req.force) args.push("--force");
  args.push(worktreePath);
  const result = await runProcess("git", args);
  if (result.code !== 0) {
    return gitRemoveWorktreeError("Failed to remove worktree", result);
  }
  return { ok: true };
}

async function nextAvailablePath(root: string, baseName: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const candidate = join(root, i === 0 ? baseName : `${baseName}-${i + 1}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not find an available worktree directory name");
}

function safeWorktreeDirectoryName(branchName: string): string {
  const cleaned = branchName
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return cleaned || "worktree";
}

function gitWorktreeError(
  prefix: string,
  result: { code: number; stdout: string; stderr: string },
): GitCreateWorktreeResponse {
  const detail = (result.stderr || result.stdout || `git exited with code ${result.code}`).trim();
  return { ok: false, error: detail ? `${prefix}: ${detail}` : prefix };
}

function gitRemoveWorktreeError(
  prefix: string,
  result: { code: number; stdout: string; stderr: string },
): GitRemoveWorktreeResponse {
  const detail = (result.stderr || result.stdout || `git exited with code ${result.code}`).trim();
  return { ok: false, error: detail ? `${prefix}: ${detail}` : prefix };
}

async function cloneGitRepository(req: GitCloneRequest): Promise<GitCloneResponse> {
  const source = await resolveCloneSource(req);
  if (!source.ok) return { ok: false, error: source.error };
  const repositoryUrl = source.url;
  if (!isAllowedCloneSource(repositoryUrl)) {
    return { ok: false, error: "Enter a valid Git URL or local repository path" };
  }
  const parent = resolvePath(req.destinationParentPath);
  const directoryName =
    sanitizeCloneDirectoryName(req.directoryName) ??
    deriveCloneDirectoryName(req.repository ?? repositoryUrl);
  if (!directoryName) return { ok: false, error: "Could not derive a destination folder name" };

  const target = resolvePath(parent, directoryName);
  if (!(await isInsideAllowedRoot(parent))) {
    return { ok: false, error: "Destination folder is not authorized" };
  }
  if (!isPathInside(target, parent)) {
    return { ok: false, error: "Destination must stay inside the selected folder" };
  }
  if (existsSync(target)) {
    return { ok: false, error: `Destination already exists: ${target}` };
  }

  const result = await runProcess("git", ["clone", "--", repositoryUrl, target], {
    timeoutMs: 120_000,
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || `git clone exited with code ${result.code}`).trim();
    return { ok: false, error: detail };
  }
  await addProjectRoot(target);
  return { ok: true, path: target, name: directoryName };
}

async function resolveCloneSource(
  req: GitCloneRequest,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const provider = req.provider;
  const repository = typeof req.repository === "string" ? req.repository.trim() : "";
  if (provider && repository) {
    if (provider === "github") return resolveGitHubCloneUrl(repository, req.protocol);
    if (provider === "gitlab") return resolveGitLabCloneUrl(repository, req.protocol);
    if (provider === "bitbucket") return resolveBitbucketCloneUrl(repository, req.protocol);
    if (provider === "azure-devops") return resolveAzureDevOpsCloneUrl(repository, req.protocol);
  }

  const repositoryUrl = typeof req.repositoryUrl === "string" ? req.repositoryUrl.trim() : "";
  if (!repositoryUrl) return { ok: false, error: "Repository URL is required" };
  return { ok: true, url: repositoryUrl };
}

async function resolveGitHubCloneUrl(
  repository: string,
  protocol: GitCloneRequest["protocol"],
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const result = await runProcess(
    "gh",
    ["repo", "view", repository, "--json", "nameWithOwner,url,sshUrl"],
    { timeoutMs: 30_000 },
  );
  if (result.code !== 0) {
    return {
      ok: false,
      error: providerLookupError("GitHub CLI", "gh auth login", result),
    };
  }
  const parsed = parseJsonObject(result.stdout);
  const url = typeof parsed?.url === "string" ? parsed.url : "";
  const sshUrl = typeof parsed?.sshUrl === "string" ? parsed.sshUrl : "";
  const selected = selectCloneProtocolUrl({ url, sshUrl }, protocol);
  if (!selected) return { ok: false, error: "GitHub CLI returned no clone URL for this repository" };
  return { ok: true, url: selected };
}

async function resolveGitLabCloneUrl(
  repository: string,
  protocol: GitCloneRequest["protocol"],
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const result = await runProcess("glab", ["api", `projects/${encodeURIComponent(repository)}`], {
    timeoutMs: 30_000,
  });
  if (result.code !== 0) {
    return {
      ok: false,
      error: providerLookupError("GitLab CLI", "glab auth login", result),
    };
  }
  const parsed = parseJsonObject(result.stdout);
  const url = typeof parsed?.http_url_to_repo === "string" ? parsed.http_url_to_repo : "";
  const sshUrl = typeof parsed?.ssh_url_to_repo === "string" ? parsed.ssh_url_to_repo : "";
  const selected = selectCloneProtocolUrl({ url, sshUrl }, protocol);
  if (!selected) return { ok: false, error: "GitLab CLI returned no clone URL for this repository" };
  return { ok: true, url: selected };
}

async function resolveBitbucketCloneUrl(
  repository: string,
  protocol: GitCloneRequest["protocol"],
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const locator = parseBitbucketRepositoryLocator(repository);
  if (!locator) return { ok: false, error: "Bitbucket repositories must be workspace/repository" };
  try {
    const parsed = await bitbucketFetchJson(
      "getRepository",
      "GET",
      `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}`,
    );
    const repositoryInfo = bitbucketRepositoryInfo(parsed);
    if (!repositoryInfo) return { ok: false, error: "Bitbucket returned no clone URL for this repository" };
    const selected = selectCloneProtocolUrl(
      { url: repositoryInfo.url, sshUrl: repositoryInfo.sshUrl },
      protocol,
    );
    if (!selected) return { ok: false, error: "Bitbucket returned no clone URL for this repository" };
    return { ok: true, url: selected };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function resolveAzureDevOpsCloneUrl(
  repository: string,
  protocol: GitCloneRequest["protocol"],
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const specifier = parseAzureDevOpsRepositorySpecifier(repository);
  if (!specifier) return { ok: false, error: "Azure DevOps repositories must be repository or project/repository" };
  const args = [
    "repos",
    "show",
    "--detect",
    "true",
    "--repository",
    specifier.repository,
    "--only-show-errors",
    "--output",
    "json",
  ];
  if (specifier.project) args.push("--project", specifier.project);

  const result = await runProcess("az", args, { timeoutMs: 30_000 });
  if (result.code !== 0) {
    return { ok: false, error: providerLookupError("Azure CLI", "az login", result) };
  }
  const parsed = parseJsonObject(result.stdout);
  const repositoryInfo = azureDevOpsRepositoryInfo(parsed);
  if (!repositoryInfo) return { ok: false, error: "Azure CLI returned no clone URL for this repository" };
  const selected = selectCloneProtocolUrl(
    { url: repositoryInfo.url, sshUrl: repositoryInfo.sshUrl },
    protocol,
  );
  if (!selected) return { ok: false, error: "Azure CLI returned no clone URL for this repository" };
  return { ok: true, url: selected };
}

function selectCloneProtocolUrl(
  urls: { url: string; sshUrl: string },
  protocol: GitCloneRequest["protocol"],
): string | null {
  if (protocol === "https") return urls.url || null;
  if (protocol === "ssh") return urls.sshUrl || null;
  return urls.sshUrl || urls.url || null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray(raw: string): Record<string, unknown>[] | null {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function providerLookupError(
  label: string,
  loginCommand: string,
  result: { code: number; stdout: string; stderr: string },
): string {
  const detail = (result.stderr || result.stdout || `${label} exited with code ${result.code}`).trim();
  const lower = detail.toLowerCase();
  if (
    lower.includes("not logged in") ||
    lower.includes("authentication") ||
    lower.includes("oauth") ||
    lower.includes("token")
  ) {
    return `${label} is not authenticated. Run \`${loginCommand}\` and retry.`;
  }
  return detail;
}

function sourceControlProviderLabel(provider: Exclude<SourceControlProviderKind, "unknown">): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azure-devops":
      return "Azure DevOps";
  }
}

async function publishSourceControlRepository(
  req: SourceControlPublishRepositoryRequest,
): Promise<SourceControlPublishRepositoryResponse> {
  if (!(await isGitRepository(req.projectPath))) {
    return { ok: false, error: "Project is not a git repository" };
  }

  const repository = normalizeRepositoryPath(req.repository);
  if (!repository) {
    return { ok: false, error: "Repository must be a provider path such as owner/name" };
  }

  const requestedRemoteName = normalizeRemoteName(req.remoteName) ?? "origin";
  if (!isSafeGitRemoteName(requestedRemoteName)) {
    return { ok: false, error: "Remote name must use letters, numbers, dots, dashes, or underscores" };
  }

  const branch = await currentGitBranch(req.projectPath) ?? await symbolicGitBranch(req.projectPath) ?? "main";
  const hasHead = await hasGitHead(req.projectPath);
  if (hasHead && !(await isValidGitBranchName(branch))) {
    return { ok: false, error: "Current git branch is not a valid ref" };
  }

  const created =
    req.provider === "github"
      ? await createGitHubRepository(req.projectPath, repository, req.visibility)
      : req.provider === "gitlab"
        ? await createGitLabRepository(req.projectPath, repository, req.visibility)
        : req.provider === "bitbucket"
          ? await createBitbucketRepository(repository, req.visibility)
          : await createAzureDevOpsRepository(req.projectPath, repository);
  if (!created.ok) return created;

  const remoteUrl = selectCloneProtocolUrl(
    { url: created.repository.url, sshUrl: created.repository.sshUrl },
    req.protocol,
  );
  if (!remoteUrl) {
    return { ok: false, error: `${sourceControlProviderLabel(req.provider)} returned no repository URL` };
  }

  const remote = await ensureSourceControlRemote(req.projectPath, requestedRemoteName, req.provider, remoteUrl);
  if (!remote.ok) return remote;

  if (!hasHead) {
    return {
      ok: true,
      repository: created.repository,
      remoteName: remote.remoteName,
      remoteUrl,
      branch,
      status: "remote_added",
    };
  }

  const pushed = await runProcess("git", ["-C", req.projectPath, "push", "-u", remote.remoteName, branch], {
    timeoutMs: 120_000,
  });
  if (pushed.code !== 0) return { ok: false, error: gitActionError("git push", pushed) };

  return {
    ok: true,
    repository: created.repository,
    remoteName: remote.remoteName,
    remoteUrl,
    branch,
    upstreamBranch: `${remote.remoteName}/${branch}`,
    status: "pushed",
  };
}

function normalizeRepositoryPath(value: string): string | null {
  const repository = value.trim().replace(/^\/+|\/+$/g, "");
  if (!repository || repository.startsWith("-") || repository.includes("\\") || repository.includes("..")) {
    return null;
  }
  const parts = repository.split("/");
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part.startsWith("-"))) {
    return null;
  }
  return parts.join("/");
}

function normalizeRemoteName(value: string | undefined): string | null {
  const remoteName = value?.trim();
  return remoteName ? remoteName : null;
}

function isSafeGitRemoteName(remoteName: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(remoteName) &&
    !remoteName.includes("..") &&
    !remoteName.endsWith(".lock");
}

async function hasGitHead(projectPath: string): Promise<boolean> {
  const result = await runProcess("git", ["-C", projectPath, "rev-parse", "--verify", "HEAD"], {
    timeoutMs: 5_000,
  });
  return result.code === 0;
}

async function symbolicGitBranch(projectPath: string): Promise<string | null> {
  const result = await runProcess("git", ["-C", projectPath, "symbolic-ref", "--quiet", "--short", "HEAD"], {
    timeoutMs: 5_000,
  });
  return result.code === 0 ? firstNonEmptyLine(result.stdout) : null;
}

async function isValidGitBranchName(branch: string): Promise<boolean> {
  const refCheck = await runProcess("git", ["check-ref-format", "--branch", branch], {
    timeoutMs: 5_000,
  });
  return refCheck.code === 0;
}

async function createGitHubRepository(
  projectPath: string,
  repository: string,
  visibility: "private" | "public",
): Promise<{ ok: true; repository: SourceControlRepositoryInfo } | { ok: false; error: string }> {
  const created = await runProcess("gh", ["repo", "create", repository, `--${visibility}`], {
    cwd: projectPath,
    timeoutMs: 60_000,
  });
  if (created.code !== 0) {
    return { ok: false, error: providerLookupError("GitHub CLI", "gh auth login", created) };
  }

  const viewed = await runProcess(
    "gh",
    ["repo", "view", repository, "--json", "nameWithOwner,url,sshUrl"],
    { cwd: projectPath, timeoutMs: 30_000 },
  );
  if (viewed.code !== 0) {
    return { ok: false, error: providerLookupError("GitHub CLI", "gh auth login", viewed) };
  }
  const parsed = parseJsonObject(viewed.stdout);
  const nameWithOwner = stringValue(parsed?.nameWithOwner) || repository;
  const url = stringValue(parsed?.url);
  const sshUrl = stringValue(parsed?.sshUrl);
  if (!url && !sshUrl) return { ok: false, error: "GitHub CLI returned no repository URL" };
  return {
    ok: true,
    repository: {
      provider: "github",
      nameWithOwner,
      url,
      sshUrl,
    },
  };
}

async function createGitLabRepository(
  projectPath: string,
  repository: string,
  visibility: "private" | "public",
): Promise<{ ok: true; repository: SourceControlRepositoryInfo } | { ok: false; error: string }> {
  const parts = repository.split("/");
  const projectName = parts.at(-1) ?? repository;
  const namespace = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
  const namespaceId = namespace ? await readGitLabNamespaceId(projectPath, namespace) : null;
  if (namespace && !namespaceId) {
    return { ok: false, error: `GitLab namespace not found: ${namespace}` };
  }

  const args = [
    "api",
    "--method",
    "POST",
    "projects",
    "--raw-field",
    `path=${projectName}`,
    "--raw-field",
    `name=${projectName}`,
    "--raw-field",
    `visibility=${visibility}`,
  ];
  if (namespaceId) args.push("--raw-field", `namespace_id=${namespaceId}`);

  const created = await runProcess("glab", args, { cwd: projectPath, timeoutMs: 60_000 });
  if (created.code !== 0) {
    return { ok: false, error: providerLookupError("GitLab CLI", "glab auth login", created) };
  }
  const parsed = parseJsonObject(created.stdout);
  const nameWithOwner = stringValue(parsed?.path_with_namespace) || repository;
  const url = stringValue(parsed?.http_url_to_repo) || stringValue(parsed?.web_url);
  const sshUrl = stringValue(parsed?.ssh_url_to_repo);
  if (!url && !sshUrl) return { ok: false, error: "GitLab CLI returned no repository URL" };
  return {
    ok: true,
    repository: {
      provider: "gitlab",
      nameWithOwner,
      url,
      sshUrl,
    },
  };
}

async function createBitbucketRepository(
  repository: string,
  visibility: "private" | "public",
): Promise<{ ok: true; repository: SourceControlRepositoryInfo } | { ok: false; error: string }> {
  const locator = parseBitbucketRepositoryLocator(repository);
  if (!locator) return { ok: false, error: "Bitbucket repositories must be workspace/repository" };
  const parsed = await bitbucketFetchJson(
    "createRepository",
    "POST",
    `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}`,
    { scm: "git", is_private: visibility === "private" },
  );
  const repositoryInfo = bitbucketRepositoryInfo(parsed);
  if (!repositoryInfo) return { ok: false, error: "Bitbucket returned no repository URL" };
  return { ok: true, repository: repositoryInfo };
}

async function createAzureDevOpsRepository(
  projectPath: string,
  repository: string,
): Promise<{ ok: true; repository: SourceControlRepositoryInfo } | { ok: false; error: string }> {
  const specifier = parseAzureDevOpsRepositorySpecifier(repository);
  if (!specifier) return { ok: false, error: "Azure DevOps repositories must be repository or project/repository" };

  const args = [
    "repos",
    "create",
    "--detect",
    "true",
    "--name",
    specifier.repository,
    "--only-show-errors",
    "--output",
    "json",
  ];
  if (specifier.project) args.push("--project", specifier.project);

  const created = await runProcess("az", args, { cwd: projectPath, timeoutMs: 60_000 });
  if (created.code !== 0) {
    return { ok: false, error: providerLookupError("Azure CLI", "az login", created) };
  }
  const parsed = parseJsonObject(created.stdout);
  const repositoryInfo = azureDevOpsRepositoryInfo(parsed);
  if (!repositoryInfo) return { ok: false, error: "Azure CLI returned no repository URL" };
  return { ok: true, repository: repositoryInfo };
}

async function readGitLabNamespaceId(projectPath: string, namespace: string): Promise<string | null> {
  const result = await runProcess("glab", ["api", `namespaces/${encodeURIComponent(namespace)}`], {
    cwd: projectPath,
    timeoutMs: 30_000,
  });
  if (result.code !== 0) return null;
  const parsed = parseJsonObject(result.stdout);
  const id = parsed?.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return stringValue(id);
}

async function ensureSourceControlRemote(
  projectPath: string,
  requestedRemoteName: string,
  provider: Exclude<SourceControlProviderKind, "unknown">,
  remoteUrl: string,
): Promise<{ ok: true; remoteName: string } | { ok: false; error: string }> {
  const remotes = await readSourceControlRemotes(projectPath);
  const existingSameUrl = remotes.find((remote) => remote.url === remoteUrl);
  if (existingSameUrl) return { ok: true, remoteName: existingSameUrl.name };

  const used = new Set(remotes.map((remote) => remote.name));
  const remoteName = chooseRemoteName(requestedRemoteName, provider, used);
  const added = await runProcess("git", ["-C", projectPath, "remote", "add", remoteName, remoteUrl], {
    timeoutMs: 10_000,
  });
  if (added.code !== 0) return { ok: false, error: gitActionError("git remote add", added) };
  return { ok: true, remoteName };
}

function chooseRemoteName(
  requestedRemoteName: string,
  provider: Exclude<SourceControlProviderKind, "unknown">,
  used: Set<string>,
): string {
  const bases = [requestedRemoteName, provider, `${provider}-remote`];
  for (const base of bases) {
    if (!used.has(base)) return base;
  }
  for (let i = 2; i < 100; i += 1) {
    for (const base of bases) {
      const candidate = `${base}-${i}`;
      if (!used.has(candidate)) return candidate;
    }
  }
  return `${provider}-${Date.now()}`;
}

function isAllowedCloneSource(value: string): boolean {
  if (!value || value.startsWith("-") || /[\r\n]/.test(value)) return false;
  if (/^(https?|ssh|git|file):\/\//i.test(value)) return true;
  if (/^[^@/:]+@[^/:]+:.+/.test(value)) return true;
  if (/^[a-zA-Z]:[\\/].+/.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("\\")) return true;
  if (value.startsWith("./") || value.startsWith("../")) return true;
  return false;
}

function deriveCloneDirectoryName(repositoryUrl: string): string | null {
  const stripped = repositoryUrl.replace(/[\\/]+$/, "");
  const candidate = stripped.split(/[\\/:]/).filter(Boolean).pop();
  return sanitizeCloneDirectoryName(candidate?.replace(/\.git$/i, ""));
}

function sanitizeCloneDirectoryName(value: string | undefined): string | null {
  const cleaned = value
    ?.trim()
    .replace(/\.git$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return cleaned || null;
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(resolvePath(parent), resolvePath(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function scanSourceControl(
  projectPath: string | undefined,
): Promise<SourceControlScanResponse> {
  const remotes = projectPath ? await readSourceControlRemotes(projectPath) : [];
  const providers = await Promise.all(
    SOURCE_CONTROL_PROVIDERS.map((provider) => scanSourceControlProvider(provider, remotes)),
  );
  return {
    ok: true,
    checkedAt: Date.now(),
    isRepo: projectPath ? await isGitRepository(projectPath) : false,
    remotes,
    providers,
  };
}

async function listSourceControlChangeRequests(
  req: SourceControlListChangeRequestsRequest,
): Promise<SourceControlListChangeRequestsResponse> {
  if (!(await isGitRepository(req.projectPath))) {
    return { ok: true, provider: "unknown", branch: null, remotes: [], changeRequests: [] };
  }

  const branch = req.headRefName?.trim() || (await currentGitBranch(req.projectPath));
  const remotes = await readSourceControlRemotes(req.projectPath);
  if (!branch) {
    return { ok: true, provider: "unknown", branch: null, remotes, changeRequests: [] };
  }

  const remote = preferredChangeRequestRemote(remotes);
  if (!remote) {
    return { ok: true, provider: "unknown", branch, remotes, changeRequests: [] };
  }

  const limit = clampChangeRequestLimit(req.limit);
  if (remote.provider === "github") {
    return {
      ok: true,
      provider: remote.provider,
      branch,
      remotes,
      changeRequests: await listGitHubPullRequests(req.projectPath, branch, req.state, limit),
    };
  }
  if (remote.provider === "gitlab") {
    return {
      ok: true,
      provider: remote.provider,
      branch,
      remotes,
      changeRequests: await listGitLabMergeRequests(req.projectPath, branch, req.state, limit),
    };
  }
  if (remote.provider === "bitbucket") {
    return {
      ok: true,
      provider: remote.provider,
      branch,
      remotes,
      changeRequests: await listBitbucketPullRequests(remote, branch, req.state, limit),
    };
  }
  if (remote.provider === "azure-devops") {
    return {
      ok: true,
      provider: remote.provider,
      branch,
      remotes,
      changeRequests: await listAzureDevOpsPullRequests(req.projectPath, branch, req.state, limit),
    };
  }

  return { ok: true, provider: remote.provider, branch, remotes, changeRequests: [] };
}

function preferredChangeRequestRemote(remotes: SourceControlRemote[]): SourceControlRemote | null {
  const supported = (remote: SourceControlRemote) =>
    remote.provider === "github" ||
    remote.provider === "gitlab" ||
    remote.provider === "bitbucket" ||
    remote.provider === "azure-devops";
  return (
    remotes.find((remote) => remote.name === "origin" && supported(remote)) ??
    remotes.find(supported) ??
    null
  );
}

async function listGitHubPullRequests(
  projectPath: string,
  branch: string,
  state: SourceControlListChangeRequestsRequest["state"],
  limit: number,
): Promise<SourceControlChangeRequest[]> {
  const ghState = state === "closed" || state === "merged" ? "closed" : state === "all" ? "all" : "open";
  const result = await runProcess(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      ghState,
      "--limit",
      String(limit),
      "--json",
      "number,title,url,baseRefName,headRefName,state",
    ],
    { cwd: projectPath, timeoutMs: 20_000 },
  );
  if (result.code !== 0) {
    throw new Error(providerLookupError("GitHub CLI", "gh auth login", result));
  }
  const items = parseJsonArray(result.stdout);
  if (!items) throw new Error("GitHub CLI returned invalid pull request JSON");
  return items.map((item) => mapGitHubPullRequest(item)).filter(isChangeRequest);
}

function mapGitHubPullRequest(item: Record<string, unknown>): SourceControlChangeRequest | null {
  const number = Number(item.number);
  const title = stringValue(item.title);
  const url = stringValue(item.url);
  if (!Number.isFinite(number) || number <= 0 || !title || !url) return null;
  return {
    provider: "github",
    number,
    title,
    url,
    baseRefName: stringValue(item.baseRefName),
    headRefName: stringValue(item.headRefName),
    state: normalizeChangeRequestState(stringValue(item.state)),
  };
}

async function listGitLabMergeRequests(
  projectPath: string,
  branch: string,
  state: SourceControlListChangeRequestsRequest["state"],
  limit: number,
): Promise<SourceControlChangeRequest[]> {
  const args = [
    "mr",
    "list",
    "--source-branch",
    branch,
    "--per-page",
    String(limit),
    "--output",
    "json",
  ];
  if (state === "closed" || state === "merged") args.push("--state", state);
  if (state === "all") args.push("--all");

  const result = await runProcess("glab", args, { cwd: projectPath, timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new Error(providerLookupError("GitLab CLI", "glab auth login", result));
  }
  const items = parseJsonArray(result.stdout);
  if (!items) throw new Error("GitLab CLI returned invalid merge request JSON");
  return items.map((item) => mapGitLabMergeRequest(item)).filter(isChangeRequest);
}

function mapGitLabMergeRequest(item: Record<string, unknown>): SourceControlChangeRequest | null {
  const number = Number(item.iid ?? item.number);
  const title = stringValue(item.title);
  const url = stringValue(item.web_url) || stringValue(item.url);
  if (!Number.isFinite(number) || number <= 0 || !title || !url) return null;
  return {
    provider: "gitlab",
    number,
    title,
    url,
    baseRefName: stringValue(item.target_branch) || stringValue(item.baseRefName),
    headRefName: stringValue(item.source_branch) || stringValue(item.headRefName),
    state: normalizeChangeRequestState(stringValue(item.state)),
  };
}

async function listBitbucketPullRequests(
  remote: SourceControlRemote,
  branch: string,
  state: SourceControlListChangeRequestsRequest["state"],
  limit: number,
): Promise<SourceControlChangeRequest[]> {
  const locator = bitbucketLocatorFromRemote(remote);
  if (!locator) throw new Error("Bitbucket remote is missing workspace/repository");
  const states = bitbucketStates(state);
  const params = new URLSearchParams();
  params.set("pagelen", String(Math.max(1, Math.min(limit, 50))));
  params.set("sort", "-updated_on");
  params.set(
    "q",
    `source.branch.name = "${escapeBitbucketQueryString(branch)}" AND ${bitbucketStateFilter(states)}`,
  );
  for (const nextState of states) params.append("state", nextState);
  const parsed = await bitbucketFetchJson(
    "listPullRequests",
    "GET",
    `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}/pullrequests?${params.toString()}`,
  );
  const values = Array.isArray(parsed.values) ? parsed.values : [];
  return values
    .map((item) => mapBitbucketPullRequest(asRecord(item)))
    .filter(isChangeRequest);
}

function mapBitbucketPullRequest(item: Record<string, unknown> | null): SourceControlChangeRequest | null {
  if (!item) return null;
  const number = Number(item.id ?? item.number);
  const title = stringValue(item.title);
  const links = asRecord(item.links);
  const html = asRecord(links?.html);
  const url = stringValue(html?.href) || stringValue(item.url);
  const source = asRecord(item.source);
  const destination = asRecord(item.destination);
  const sourceBranch = asRecord(source?.branch);
  const destinationBranch = asRecord(destination?.branch);
  if (!Number.isFinite(number) || number <= 0 || !title || !url) return null;
  return {
    provider: "bitbucket",
    number,
    title,
    url,
    baseRefName: stringValue(destinationBranch?.name),
    headRefName: stringValue(sourceBranch?.name),
    state: normalizeBitbucketPullRequestState(stringValue(item.state)),
  };
}

function normalizeBitbucketPullRequestState(value: string): ChangeRequestState {
  switch (value.trim().toUpperCase()) {
    case "MERGED":
      return "merged";
    case "DECLINED":
    case "SUPERSEDED":
      return "closed";
    default:
      return "open";
  }
}

async function listAzureDevOpsPullRequests(
  projectPath: string,
  branch: string,
  state: SourceControlListChangeRequestsRequest["state"],
  limit: number,
): Promise<SourceControlChangeRequest[]> {
  const result = await runProcess(
    "az",
    [
      "repos",
      "pr",
      "list",
      "--detect",
      "true",
      "--source-branch",
      branch,
      "--status",
      azureDevOpsPullRequestStatus(state),
      "--top",
      String(limit),
      "--only-show-errors",
      "--output",
      "json",
    ],
    { cwd: projectPath, timeoutMs: 20_000 },
  );
  if (result.code !== 0) {
    throw new Error(providerLookupError("Azure CLI", "az login", result));
  }
  const items = parseJsonArray(result.stdout);
  if (!items) throw new Error("Azure CLI returned invalid pull request JSON");
  return items.map((item) => mapAzureDevOpsPullRequest(item)).filter(isChangeRequest);
}

function mapAzureDevOpsPullRequest(item: Record<string, unknown>): SourceControlChangeRequest | null {
  const number = Number(item.pullRequestId ?? item.id ?? item.number);
  const title = stringValue(item.title);
  const links = asRecord(item._links);
  const web = asRecord(links?.web);
  const url = stringValue(web?.href) || stringValue(item.url);
  if (!Number.isFinite(number) || number <= 0 || !title || !url) return null;
  return {
    provider: "azure-devops",
    number,
    title,
    url,
    baseRefName: normalizeAzureDevOpsRef(stringValue(item.targetRefName)),
    headRefName: normalizeAzureDevOpsRef(stringValue(item.sourceRefName)),
    state: normalizeAzureDevOpsPullRequestState(stringValue(item.status)),
  };
}

function azureDevOpsPullRequestStatus(state: SourceControlListChangeRequestsRequest["state"]): string {
  if (state === "closed") return "abandoned";
  if (state === "merged") return "completed";
  if (state === "all") return "all";
  return "active";
}

function normalizeAzureDevOpsPullRequestState(value: string): ChangeRequestState {
  switch (value.trim().toLowerCase()) {
    case "completed":
      return "merged";
    case "abandoned":
      return "closed";
    default:
      return "open";
  }
}

function normalizeAzureDevOpsRef(value: string): string {
  return value.replace(/^refs\/heads\//, "").trim();
}

function normalizeChangeRequestState(value: string): ChangeRequestState {
  const normalized = value.trim().toLowerCase();
  if (normalized === "merged") return "merged";
  if (normalized === "closed" || normalized === "closed_success") return "closed";
  return "open";
}

function isChangeRequest(value: SourceControlChangeRequest | null): value is SourceControlChangeRequest {
  return value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampChangeRequestLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(25, Math.max(1, Math.trunc(value)))
    : 5;
}

function isAllowedChangeRequestUrl(url: string, remotes: SourceControlRemote[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return remotes.some((remote) => remote.host === host && remote.provider !== "unknown");
}

async function checkoutSourceControlChangeRequest(
  req: SourceControlCheckoutChangeRequestRequest,
): Promise<SourceControlCheckoutChangeRequestResponse> {
  if (!(await isGitRepository(req.projectPath))) {
    return { ok: false, error: "Project is not a git repository" };
  }
  const remotes = await readSourceControlRemotes(req.projectPath);
  const remote = preferredChangeRequestRemote(remotes);
  if (!remote || remote.provider !== req.provider) {
    return { ok: false, error: `${sourceControlProviderLabel(req.provider)} remote not found for this repository` };
  }

  const result =
    req.provider === "github"
      ? await runProcess("gh", ["pr", "checkout", String(req.number)], {
          cwd: req.projectPath,
          timeoutMs: 60_000,
        })
      : req.provider === "gitlab"
        ? await runProcess("glab", ["mr", "checkout", String(req.number)], {
            cwd: req.projectPath,
            timeoutMs: 60_000,
          })
        : req.provider === "bitbucket"
          ? await checkoutBitbucketPullRequest(req.projectPath, remote, req.number)
          : await runProcess(
              "az",
              [
                "repos",
                "pr",
                "checkout",
                "--only-show-errors",
                "--detect",
                "true",
                "--id",
                String(req.number),
                "--remote-name",
                remote.name,
              ],
              { cwd: req.projectPath, timeoutMs: 60_000 },
            );
  if (result.code !== 0) {
    if (req.provider === "bitbucket") return { ok: false, error: gitActionError("Bitbucket checkout", result) };
    const label =
      req.provider === "github" ? "GitHub CLI" : req.provider === "gitlab" ? "GitLab CLI" : "Azure CLI";
    const login =
      req.provider === "github" ? "gh auth login" : req.provider === "gitlab" ? "glab auth login" : "az login";
    return { ok: false, error: providerLookupError(label, login, result) };
  }
  return { ok: true, refName: await currentGitBranch(req.projectPath) };
}

async function createSourceControlChangeRequest(
  req: SourceControlCreateChangeRequestRequest,
): Promise<SourceControlCreateChangeRequestResponse> {
  const provider = req.provider;

  if (!(await isGitRepository(req.projectPath))) {
    return { ok: false, error: "Project is not a git repository" };
  }

  const branch = await currentGitBranch(req.projectPath);
  if (!branch) {
    return { ok: false, error: "Cannot create a PR/MR from detached HEAD" };
  }

  const refCheck = await runProcess("git", ["check-ref-format", "--branch", branch], {
    timeoutMs: 5_000,
  });
  if (refCheck.code !== 0) return { ok: false, error: "Current git branch is not a valid ref" };

  const remotes = await readSourceControlRemotes(req.projectPath);
  const remote = preferredChangeRequestRemote(remotes);
  if (!remote || remote.provider !== provider) {
    return { ok: false, error: `${sourceControlProviderLabel(provider)} remote not found for this repository` };
  }

  const existing = await listSourceControlChangeRequests({
    projectPath: req.projectPath,
    headRefName: branch,
    state: "open",
    limit: 5,
  }).then((response) =>
    response.ok
      ? response.changeRequests.find((item) => item.provider === provider) ?? null
      : null,
  );
  if (existing) {
    return {
      ok: true,
      status: "existing",
      provider,
      branch,
      baseRefName: existing.baseRefName,
      pushed: false,
      changeRequest: existing,
    };
  }

  const baseRefName = await resolveChangeRequestBaseRef(req.projectPath, provider, req.baseRefName);
  const shouldPush = req.push !== false;
  if (shouldPush) {
    const pushed = await runProcess("git", ["-C", req.projectPath, "push", "-u", remote.name, branch], {
      timeoutMs: 120_000,
    });
    if (pushed.code !== 0) {
      return { ok: false, error: gitActionError("git push", pushed) };
    }
  }

  const bodyFile = await writeChangeRequestBody(req.body ?? "");
  try {
  const created =
    provider === "github"
      ? await createGitHubPullRequest(req.projectPath, {
          baseRefName,
          headRefName: branch,
          title: req.title.trim(),
          bodyFile,
        })
      : provider === "gitlab"
        ? await createGitLabMergeRequest(req.projectPath, {
            baseRefName,
            headRefName: branch,
            title: req.title.trim(),
            bodyFile,
          })
        : provider === "bitbucket"
          ? await createBitbucketPullRequest(remote, {
              baseRefName,
              headRefName: branch,
              title: req.title.trim(),
              bodyFile,
            })
          : await createAzureDevOpsPullRequest(req.projectPath, {
              baseRefName,
              headRefName: branch,
              title: req.title.trim(),
              bodyFile,
            });

    if (created.code !== 0) {
      const afterFailure = await listSourceControlChangeRequests({
        projectPath: req.projectPath,
        headRefName: branch,
        state: "open",
        limit: 5,
      });
      const found =
        afterFailure.ok
          ? afterFailure.changeRequests.find((item) => item.provider === provider) ?? null
          : null;
      if (found) {
        return {
          ok: true,
          status: "existing",
          provider,
          branch,
          baseRefName: found.baseRefName,
          pushed: shouldPush,
          changeRequest: found,
        };
      }
      if (provider === "bitbucket") return { ok: false, error: gitActionError("Bitbucket PR create", created) };
      const label = provider === "github" ? "GitHub CLI" : provider === "gitlab" ? "GitLab CLI" : "Azure CLI";
      const login = provider === "github" ? "gh auth login" : provider === "gitlab" ? "glab auth login" : "az login";
      return { ok: false, error: providerLookupError(label, login, created) };
    }

    const listed = await listSourceControlChangeRequests({
      projectPath: req.projectPath,
      headRefName: branch,
      state: "open",
      limit: 5,
    });
    const changeRequest =
      listed.ok
        ? listed.changeRequests.find((item) => item.provider === provider) ?? null
        : null;

    return {
      ok: true,
      status: "created",
      provider,
      branch,
      baseRefName,
      pushed: shouldPush,
      changeRequest,
    };
  } finally {
    await unlink(bodyFile).catch(() => undefined);
  }
}

async function resolveChangeRequestBaseRef(
  projectPath: string,
  provider: Exclude<SourceControlProviderKind, "unknown">,
  requestedBase: string | undefined,
): Promise<string> {
  const explicit = requestedBase?.trim();
  if (explicit) return explicit;

  const fromProvider =
    provider === "github"
      ? await readGitHubDefaultBranch(projectPath)
      : provider === "gitlab"
        ? await readGitLabDefaultBranch(projectPath)
        : provider === "bitbucket"
          ? await readBitbucketDefaultBranch(projectPath)
          : await readAzureDevOpsDefaultBranch(projectPath);
  if (fromProvider) return fromProvider;

  const refs = await runProcess("git", ["-C", projectPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes"], {
    timeoutMs: 7_000,
  });
  const names = refs.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (names.some((name) => name.endsWith("/main"))) return "main";
  if (names.some((name) => name.endsWith("/master"))) return "master";
  return "main";
}

async function readGitHubDefaultBranch(projectPath: string): Promise<string | null> {
  const result = await runProcess(
    "gh",
    ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
    { cwd: projectPath, timeoutMs: 10_000 },
  );
  return result.code === 0 ? firstNonEmptyLine(result.stdout) : null;
}

async function readGitLabDefaultBranch(projectPath: string): Promise<string | null> {
  const result = await runProcess("glab", ["api", "projects/:fullpath"], {
    cwd: projectPath,
    timeoutMs: 10_000,
  });
  if (result.code !== 0) return null;
  const parsed = parseJsonObject(result.stdout);
  return stringValue(parsed?.default_branch) || null;
}

async function readBitbucketDefaultBranch(projectPath: string): Promise<string | null> {
  const remote = preferredChangeRequestRemote(await readSourceControlRemotes(projectPath));
  if (!remote || remote.provider !== "bitbucket") return null;
  const locator = bitbucketLocatorFromRemote(remote);
  if (!locator) return null;
  const repository = await bitbucketFetchJson(
    "getRepository",
    "GET",
    `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}`,
  ).catch(() => null);
  const repoMain = stringValue(asRecord(asRecord(repository)?.mainbranch)?.name);
  const branching = await bitbucketFetchJson(
    "getBranchingModel",
    "GET",
    `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}/branching-model`,
  ).catch(() => null);
  const development = asRecord(asRecord(branching)?.development);
  const branch = asRecord(development?.branch);
  const valid = development?.is_valid !== false;
  const useMain = development?.use_mainbranch === true;
  const developmentName = stringValue(branch?.name) || stringValue(development?.name);
  if (valid && !useMain && developmentName && developmentName !== "null") return developmentName;
  return repoMain || null;
}

async function readAzureDevOpsDefaultBranch(projectPath: string): Promise<string | null> {
  const result = await runProcess(
    "az",
    ["repos", "show", "--detect", "true", "--only-show-errors", "--output", "json"],
    { cwd: projectPath, timeoutMs: 10_000 },
  );
  if (result.code !== 0) return null;
  const parsed = parseJsonObject(result.stdout);
  return normalizeAzureDevOpsRef(stringValue(parsed?.defaultBranch)) || null;
}

async function writeChangeRequestBody(body: string): Promise<string> {
  const file = join(tmpdir(), `debase-change-request-${process.pid}-${randomUUID()}.md`);
  await writeFile(file, body.trim() ? body : "Created from debase.", "utf8");
  return file;
}

function createGitHubPullRequest(
  projectPath: string,
  input: { baseRefName: string; headRefName: string; title: string; bodyFile: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runProcess(
    "gh",
    [
      "pr",
      "create",
      "--base",
      input.baseRefName,
      "--head",
      input.headRefName,
      "--title",
      input.title,
      "--body-file",
      input.bodyFile,
    ],
    { cwd: projectPath, timeoutMs: 60_000 },
  );
}

function createGitLabMergeRequest(
  projectPath: string,
  input: { baseRefName: string; headRefName: string; title: string; bodyFile: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runProcess(
    "glab",
    [
      "api",
      "--method",
      "POST",
      "projects/:fullpath/merge_requests",
      "--raw-field",
      `source_branch=${input.headRefName}`,
      "--raw-field",
      `target_branch=${input.baseRefName}`,
      "--raw-field",
      `title=${input.title}`,
      "--field",
      `description=@${input.bodyFile}`,
    ],
    { cwd: projectPath, timeoutMs: 60_000 },
  );
}

function createAzureDevOpsPullRequest(
  projectPath: string,
  input: { baseRefName: string; headRefName: string; title: string; bodyFile: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runProcess(
    "az",
    [
      "repos",
      "pr",
      "create",
      "--only-show-errors",
      "--detect",
      "true",
      "--target-branch",
      input.baseRefName,
      "--source-branch",
      input.headRefName,
      "--title",
      input.title,
      "--description",
      `@${input.bodyFile}`,
    ],
    { cwd: projectPath, timeoutMs: 60_000 },
  );
}

async function createBitbucketPullRequest(
  remote: SourceControlRemote,
  input: { baseRefName: string; headRefName: string; title: string; bodyFile: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const locator = bitbucketLocatorFromRemote(remote);
  if (!locator) return { code: 1, stdout: "", stderr: "Bitbucket remote is missing workspace/repository" };
  try {
    const description = await readFile(input.bodyFile, "utf8");
    const created = await bitbucketFetchJson(
      "createPullRequest",
      "POST",
      `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}/pullrequests`,
      {
        title: input.title,
        description,
        source: {
          branch: { name: input.headRefName },
        },
        destination: {
          branch: { name: input.baseRefName },
        },
      },
    );
    return { code: 0, stdout: JSON.stringify(created), stderr: "" };
  } catch (err) {
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

async function checkoutBitbucketPullRequest(
  projectPath: string,
  remote: SourceControlRemote,
  number: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const locator = bitbucketLocatorFromRemote(remote);
  if (!locator) return { code: 1, stdout: "", stderr: "Bitbucket remote is missing workspace/repository" };
  try {
    const raw = await bitbucketFetchJson(
      "getPullRequest",
      "GET",
      `/repositories/${encodeURIComponent(locator.workspace)}/${encodeURIComponent(locator.repoSlug)}/pullrequests/${encodeURIComponent(String(number))}`,
    );
    const source = asRecord(raw.source);
    const destination = asRecord(raw.destination);
    const sourceBranch = stringValue(asRecord(source?.branch)?.name);
    if (!sourceBranch) return { code: 1, stdout: "", stderr: "Bitbucket pull request has no source branch" };

    const sourceRepo = stringValue(asRecord(source?.repository)?.full_name);
    const destinationRepo = stringValue(asRecord(destination?.repository)?.full_name) || `${locator.workspace}/${locator.repoSlug}`;
    const crossRepository = Boolean(sourceRepo && sourceRepo !== destinationRepo);
    const remoteName = crossRepository
      ? await ensureBitbucketSourceRemote(projectPath, sourceRepo, remote.url)
      : remote.name;
    if (!remoteName) return { code: 1, stdout: "", stderr: "Unable to resolve Bitbucket source remote" };

    const localBranch = crossRepository
      ? `debase/pr-${number}/${sanitizeBranchFragment(sourceBranch)}`
      : sourceBranch;
    if (!(await isValidGitBranchName(sourceBranch)) || !(await isValidGitBranchName(localBranch))) {
      return { code: 1, stdout: "", stderr: "Bitbucket pull request branch is not a valid git ref" };
    }

    const fetchRef = `+refs/heads/${sourceBranch}:refs/remotes/${remoteName}/${sourceBranch}`;
    const fetched = await runProcess("git", ["-C", projectPath, "fetch", remoteName, fetchRef], {
      timeoutMs: 120_000,
    });
    if (fetched.code !== 0) return fetched;

    const exists = await runProcess("git", ["-C", projectPath, "show-ref", "--verify", "--quiet", `refs/heads/${localBranch}`], {
      timeoutMs: 5_000,
    });
    const switched = exists.code === 0
      ? await runProcess("git", ["-C", projectPath, "switch", localBranch], { timeoutMs: 30_000 })
      : await runProcess("git", ["-C", projectPath, "switch", "-c", localBranch, "--track", `${remoteName}/${sourceBranch}`], {
          timeoutMs: 30_000,
        });
    if (switched.code !== 0) return switched;

    const upstream = await runProcess("git", ["-C", projectPath, "branch", "--set-upstream-to", `${remoteName}/${sourceBranch}`, localBranch], {
      timeoutMs: 10_000,
    });
    return upstream.code === 0 ? { code: 0, stdout: localBranch, stderr: "" } : upstream;
  } catch (err) {
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

async function ensureBitbucketSourceRemote(
  projectPath: string,
  sourceRepository: string,
  originRemoteUrl: string,
): Promise<string | null> {
  const repository = await bitbucketFetchJson(
    "getRepository",
    "GET",
    `/repositories/${encodeURIComponent(sourceRepository.split("/")[0] ?? "")}/${encodeURIComponent(sourceRepository.split("/")[1] ?? "")}`,
  );
  const info = bitbucketRepositoryInfo(repository);
  if (!info) return null;
  const remoteUrl = originRemoteUrl.startsWith("git@") || originRemoteUrl.startsWith("ssh://")
    ? info.sshUrl
    : info.url;
  const owner = sourceRepository.split("/")[0]?.trim() || "bitbucket";
  const remote = await ensureSourceControlRemote(projectPath, owner, "bitbucket", remoteUrl);
  return remote.ok ? remote.remoteName : null;
}

function sanitizeBranchFragment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 80) || "branch";
}

function gitActionError(label: string, result: { code: number; stdout: string; stderr: string }): string {
  const detail = (result.stderr || result.stdout || `${label} exited with code ${result.code}`).trim();
  return `${label} failed: ${detail}`;
}

type BitbucketRepositoryLocator = {
  workspace: string;
  repoSlug: string;
};

function bitbucketAuthConfig():
  | { ok: true; header: string; baseUrl: string; account: string | null }
  | { ok: false; error: string } {
  const baseUrl = (
    process.env.DEBASE_BITBUCKET_API_BASE_URL ??
    process.env.T3CODE_BITBUCKET_API_BASE_URL ??
    "https://api.bitbucket.org/2.0"
  ).replace(/\/+$/g, "");
  const accessToken = process.env.DEBASE_BITBUCKET_ACCESS_TOKEN ?? process.env.T3CODE_BITBUCKET_ACCESS_TOKEN;
  if (accessToken?.trim()) {
    return { ok: true, header: `Bearer ${accessToken.trim()}`, baseUrl, account: null };
  }
  const email = process.env.DEBASE_BITBUCKET_EMAIL ?? process.env.T3CODE_BITBUCKET_EMAIL;
  const token = process.env.DEBASE_BITBUCKET_API_TOKEN ?? process.env.T3CODE_BITBUCKET_API_TOKEN;
  if (email?.trim() && token?.trim()) {
    const encoded = Buffer.from(`${email.trim()}:${token.trim()}`, "utf8").toString("base64");
    return { ok: true, header: `Basic ${encoded}`, baseUrl, account: email.trim() };
  }
  return {
    ok: false,
    error: "Set DEBASE_BITBUCKET_EMAIL and DEBASE_BITBUCKET_API_TOKEN, or DEBASE_BITBUCKET_ACCESS_TOKEN.",
  };
}

async function bitbucketFetchJson(
  operation: string,
  method: "GET" | "POST",
  apiPath: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const auth = bitbucketAuthConfig();
  if (!auth.ok) throw new Error(auth.error);
  const url = apiPath.startsWith("http") ? apiPath : `${auth.baseUrl}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      authorization: auth.header,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.trim() ? `Bitbucket ${operation} returned HTTP ${response.status}: ${text.trim()}` : `Bitbucket ${operation} returned HTTP ${response.status}`);
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to the typed error below
  }
  throw new Error(`Bitbucket ${operation} returned invalid JSON`);
}

function bitbucketLocatorFromRemote(remote: SourceControlRemote): BitbucketRepositoryLocator | null {
  if (remote.provider !== "bitbucket" || !remote.owner || !remote.repo) return null;
  return { workspace: remote.owner, repoSlug: remote.repo };
}

function parseBitbucketRepositoryLocator(repository: string): BitbucketRepositoryLocator | null {
  const normalized = repository.trim().replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const workspace = parts.at(-2);
  const repoSlug = parts.at(-1);
  return workspace && repoSlug ? { workspace, repoSlug } : null;
}

function bitbucketStates(state: SourceControlListChangeRequestsRequest["state"]): string[] {
  if (state === "closed") return ["DECLINED", "SUPERSEDED"];
  if (state === "merged") return ["MERGED"];
  if (state === "all") return ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"];
  return ["OPEN"];
}

function bitbucketStateFilter(states: string[]): string {
  return states.length === 1
    ? `state = "${states[0]}"`
    : `(${states.map((state) => `state = "${state}"`).join(" OR ")})`;
}

function escapeBitbucketQueryString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function bitbucketRepositoryInfo(raw: Record<string, unknown>): SourceControlRepositoryInfo | null {
  const fullName = stringValue(raw.full_name);
  const links = asRecord(raw.links);
  const html = asRecord(links?.html);
  const clones = Array.isArray(links?.clone) ? links.clone.map(asRecord).filter((item) => item !== null) : [];
  const httpsUrl =
    stringValue(clones.find((entry) => stringValue(entry.name).toLowerCase() === "https")?.href) ||
    stringValue(html?.href);
  const sshUrl =
    stringValue(clones.find((entry) => stringValue(entry.name).toLowerCase() === "ssh")?.href) ||
    httpsUrl;
  if (!fullName || (!httpsUrl && !sshUrl)) return null;
  return {
    provider: "bitbucket",
    nameWithOwner: fullName,
    url: httpsUrl,
    sshUrl,
  };
}

function parseAzureDevOpsRepositorySpecifier(repository: string): { project: string | null; repository: string } | null {
  const parts = repository.split("/").filter(Boolean);
  if (parts.length === 1) return { project: null, repository: parts[0] ?? "" };
  if (parts.length === 2) return { project: parts[0] ?? null, repository: parts[1] ?? "" };
  return null;
}

function azureDevOpsRepositoryInfo(raw: Record<string, unknown> | null): SourceControlRepositoryInfo | null {
  if (!raw) return null;
  const name = stringValue(raw.name);
  const project = asRecord(raw.project);
  const projectName = stringValue(project?.name);
  const url = stringValue(raw.remoteUrl) || stringValue(raw.webUrl);
  const sshUrl = stringValue(raw.sshUrl) || url;
  if (!name || (!url && !sshUrl)) return null;
  return {
    provider: "azure-devops",
    nameWithOwner: projectName ? `${projectName}/${name}` : name,
    url,
    sshUrl,
  };
}

const SOURCE_CONTROL_PROVIDERS: {
  kind: Exclude<SourceControlProviderKind, "unknown">;
  label: string;
  executable: string | null;
  versionArgs?: string[];
  installHint: string;
  authHint: string;
}[] = [
  {
    kind: "github",
    label: "GitHub",
    executable: "gh",
    versionArgs: ["--version"],
    installHint: "Install GitHub CLI (`gh`) and run `gh auth login`.",
    authHint: "Run `gh auth login` on this machine.",
  },
  {
    kind: "gitlab",
    label: "GitLab",
    executable: "glab",
    versionArgs: ["--version"],
    installHint: "Install GitLab CLI (`glab`) and run `glab auth login`.",
    authHint: "Run `glab auth login` on this machine.",
  },
  {
    kind: "bitbucket",
    label: "Bitbucket",
    executable: null,
    installHint: "Set Bitbucket email and API token environment variables.",
    authHint: "Set DEBASE_BITBUCKET_EMAIL and DEBASE_BITBUCKET_API_TOKEN.",
  },
  {
    kind: "azure-devops",
    label: "Azure DevOps",
    executable: "az",
    versionArgs: ["--version"],
    installHint: "Install Azure CLI (`az`) with the Azure DevOps extension.",
    authHint: "Run `az login` on this machine.",
  },
];

async function isGitRepository(projectPath: string): Promise<boolean> {
  const result = await runProcess("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"], {
    timeoutMs: 5_000,
  });
  return result.code === 0 && result.stdout.trim() === "true";
}

async function readSourceControlRemotes(projectPath: string): Promise<SourceControlRemote[]> {
  if (!(await isGitRepository(projectPath))) return [];
  const configured = await readConfiguredSourceControlRemotes(projectPath);
  if (configured.length > 0) return configured;

  const result = await runProcess("git", ["-C", projectPath, "remote", "-v"], {
    timeoutMs: 5_000,
  });
  if (result.code !== 0) return [];
  const seen = new Set<string>();
  const remotes: SourceControlRemote[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, direction] = match;
    if (direction !== "fetch") continue;
    const key = `${name}\0${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name, url, ...parseSourceControlRemote(url) });
  }
  return remotes.sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
}

async function readConfiguredSourceControlRemotes(projectPath: string): Promise<SourceControlRemote[]> {
  const result = await runProcess(
    "git",
    ["-C", projectPath, "config", "--get-regexp", "^remote\\..*\\.url$"],
    { timeoutMs: 5_000 },
  );
  if (result.code !== 0) return [];

  const seen = new Set<string>();
  const remotes: SourceControlRemote[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^remote\.([^.\s]+)\.url\s+(.+)$/);
    if (!match) continue;
    const [, name, url] = match;
    if (!name || !url) continue;
    const key = `${name}\0${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name, url, ...parseSourceControlRemote(url) });
  }
  return remotes.sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
}

function parseSourceControlRemote(
  url: string,
): Pick<SourceControlRemote, "provider" | "host" | "owner" | "repo"> {
  const normalized = normalizeRemoteUrl(url);
  const parsed = safeRemoteUrl(normalized);
  const host = parsed?.hostname.toLowerCase() ?? parseScpLikeHost(url);
  const parts = parsed ? pathParts(parsed.pathname) : pathParts(parseScpLikePath(url));
  if (!host) return { provider: "unknown", host: null, owner: null, repo: null };

  if (host === "github.com") {
    return simpleRemote("github", host, parts);
  }
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) {
    return simpleRemote("gitlab", host, parts);
  }
  if (host === "bitbucket.org") {
    return simpleRemote("bitbucket", host, parts);
  }
  if (host === "dev.azure.com") {
    const owner = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? null);
    const repo = repoName(parts[parts.length - 1]);
    return { provider: "azure-devops", host, owner, repo };
  }
  if (
    host === "ssh.dev.azure.com" ||
    host.endsWith(".visualstudio.com") ||
    host.endsWith(".vs-ssh.visualstudio.com")
  ) {
    const repo = repoName(parts[parts.length - 1]);
    const owner = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? null);
    return { provider: "azure-devops", host, owner, repo };
  }
  return { provider: "unknown", host, owner: parts[0] ?? null, repo: repoName(parts.at(-1)) };
}

function normalizeRemoteUrl(url: string): string {
  if (/^[^@/:]+@[^/:]+:.+/.test(url)) {
    return `ssh://${url.replace(":", "/")}`;
  }
  return url;
}

function safeRemoteUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function parseScpLikeHost(url: string): string | null {
  const match = url.match(/^[^@/:]+@([^/:]+):/);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseScpLikePath(url: string): string {
  const match = url.match(/^[^@/:]+@[^/:]+:(.+)$/);
  return match?.[1] ?? "";
}

function pathParts(pathname: string): string[] {
  return pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function simpleRemote(
  provider: Exclude<SourceControlProviderKind, "azure-devops" | "unknown">,
  host: string,
  parts: string[],
): Pick<SourceControlRemote, "provider" | "host" | "owner" | "repo"> {
  return {
    provider,
    host,
    owner: parts[0] ?? null,
    repo: repoName(parts[1]),
  };
}

function repoName(value: string | undefined): string | null {
  const repo = value?.replace(/\.git$/i, "").trim();
  return repo || null;
}

async function scanSourceControlProvider(
  provider: (typeof SOURCE_CONTROL_PROVIDERS)[number],
  remotes: SourceControlRemote[],
): Promise<SourceControlProviderDiscovery> {
  const matchedRemotes = remotes.filter((remote) => remote.provider === provider.kind);
  if (provider.kind === "bitbucket") {
    const auth = bitbucketAuthConfig();
    const probed = auth.ok
      ? await bitbucketFetchJson("probeAuth", "GET", "/user").catch(() => null)
      : null;
    const account =
      stringValue(probed?.username) ||
      stringValue(probed?.display_name) ||
      stringValue(probed?.account_id) ||
      (auth.ok ? auth.account : null);
    return {
      kind: provider.kind,
      label: provider.label,
      executable: null,
      available: auth.ok,
      version: null,
      authStatus: auth.ok ? "authenticated" : "unavailable",
      account,
      installHint: provider.installHint,
      authHint: provider.authHint,
      matchedRemotes,
    };
  }

  const executable = provider.executable;
  const version = executable
    ? await runProcess(executable, provider.versionArgs ?? ["--version"], { timeoutMs: 5_000 })
    : null;
  if (!executable || !version || version.code !== 0) {
    return {
      kind: provider.kind,
      label: provider.label,
      executable,
      available: false,
      version: null,
      authStatus: "unavailable",
      account: null,
      installHint: provider.installHint,
      authHint: provider.authHint,
      matchedRemotes,
    };
  }

  const auth = await readProviderAuth(provider.kind);
  return {
    kind: provider.kind,
    label: provider.label,
    executable,
    available: true,
    version: firstNonEmptyLine(version.stdout || version.stderr),
    authStatus: auth.status,
    account: auth.account,
    installHint: provider.installHint,
    authHint: provider.authHint,
    matchedRemotes,
  };
}

async function readProviderAuth(
  kind: Exclude<SourceControlProviderKind, "unknown">,
): Promise<{ status: SourceControlProviderDiscovery["authStatus"]; account: string | null }> {
  if (kind === "github") {
    const status = await runProcess("gh", ["auth", "status"], { timeoutMs: 7_000 });
    if (status.code !== 0) return { status: "unauthenticated", account: null };
    const user = await runProcess("gh", ["api", "user", "--jq", ".login"], { timeoutMs: 7_000 });
    return {
      status: "authenticated",
      account: user.code === 0 ? firstNonEmptyLine(user.stdout) : parseGitHubAccount(status.stderr),
    };
  }
  if (kind === "gitlab") {
    const status = await runProcess("glab", ["auth", "status"], { timeoutMs: 7_000 });
    return {
      status: status.code === 0 ? "authenticated" : "unauthenticated",
      account: status.code === 0 ? parseGitLabAccount(status.stdout || status.stderr) : null,
    };
  }
  if (kind === "azure-devops") {
    const account = await runProcess(
      "az",
      ["account", "show", "--query", "user.name", "-o", "tsv"],
      { timeoutMs: 7_000 },
    );
    return {
      status: account.code === 0 && firstNonEmptyLine(account.stdout) ? "authenticated" : "unauthenticated",
      account: account.code === 0 ? firstNonEmptyLine(account.stdout) : null,
    };
  }
  return { status: "unknown", account: null };
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function parseGitHubAccount(output: string): string | null {
  return output.match(/Logged in to .+ as ([^\s]+)/i)?.[1] ?? null;
}

function parseGitLabAccount(output: string): string | null {
  return output.match(/Logged in to .+ as ([^\s]+)/i)?.[1] ?? null;
}

function parseBranchHeader(header: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  if (!header) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const statusMatch = header.match(/\s+\[(.+)\]$/);
  const status = statusMatch?.[1] ?? "";
  const refPart = statusMatch ? header.slice(0, statusMatch.index).trim() : header.trim();
  const [branchRaw, upstreamRaw] = refPart.split("...");
  const branch = branchRaw === "HEAD (no branch)" ? null : branchRaw || null;
  const ahead = Number(status.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(status.match(/behind (\d+)/)?.[1] ?? 0);
  return { branch, upstream: upstreamRaw || null, ahead, behind };
}

function parseGitStatusLine(line: string): { path: string; index: string; worktree: string } | null {
  if (line.length < 4) return null;
  const index = line[0] ?? " ";
  const worktree = line[1] ?? " ";
  const rawPath = line.slice(3);
  const renameTarget = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()! : rawPath;
  const path = renameTarget.replace(/^"|"$/g, "");
  return { path, index, worktree };
}

function isConflictStatus(index: string, worktree: string): boolean {
  return (
    index === "U" ||
    worktree === "U" ||
    (index === "A" && worktree === "A") ||
    (index === "D" && worktree === "D")
  );
}

function isUnsafeRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.trim().length === 0) return true;
  if (/^[a-zA-Z]:[\\/]/.test(relativePath)) return true;
  if (relativePath.startsWith("/") || relativePath.startsWith("\\")) return true;
  return /(^|[\\/])\.\.([\\/]|$)/.test(relativePath);
}

function runProcess(
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options?.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer =
      typeof options?.timeoutMs === "number" && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            finish({ code: -1, stdout, stderr: `Timed out after ${options.timeoutMs}ms` });
          }, options.timeoutMs)
        : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      finish({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function validateSendRequest(req: SendPromptRequest): Promise<void> {
  if (!req || typeof req !== "object") throw new Error("Invalid request");
  if (typeof req.requestId !== "string" || req.requestId.length === 0) {
    throw new Error("Missing requestId");
  }
  if (typeof req.threadId !== "string" || req.threadId.length === 0) {
    throw new Error("Missing threadId");
  }
  if (typeof req.prompt !== "string" || req.prompt.trim().length === 0) {
    throw new Error("Empty prompt");
  }
  if (
    req.provider !== "claude" &&
    req.provider !== "codex" &&
    req.provider !== "opencode" &&
    req.provider !== "cursor"
  ) {
    throw new Error("Unknown provider");
  }
  if (!req.runConfig || typeof req.runConfig !== "object") {
    throw new Error("Missing runConfig");
  }
  if (typeof req.runConfig.model !== "string" || req.runConfig.model.length === 0) {
    throw new Error("Missing model");
  }
  if (req.runConfig.provider !== req.provider) {
    throw new Error("Provider mismatch");
  }
  // cwd, when supplied, must be inside a project root the user has authorized
  // through the native chooseDirectory dialog (or via the one-shot bootstrap
  // import). A compromised renderer otherwise gets to point the agent at the
  // root of the filesystem.
  if (req.cwd != null) {
    if (typeof req.cwd !== "string" || req.cwd.length === 0) {
      throw new Error("Invalid cwd");
    }
    const allowed = await isInsideAllowedRoot(req.cwd);
    if (!allowed) {
      throw new Error("cwd is not inside an authorized project root");
    }
  }
  const runtime = sanitizeProviderRuntime(req.providerRuntime);
  if (req.provider === "opencode") {
    const catalog = await loadOpenCodeCatalog(req.cwd ?? process.cwd(), runtime.opencode);
    const model = findModel(req.runConfig.model, catalog);
    if (!catalog.opencode.available || !model || model.provider !== "opencode") {
      throw new Error(
        catalog.opencode.error ??
          "OpenCode has no connected provider for this model. Run opencode auth login, then refresh providers.",
      );
    }
    if (
      req.runConfig.opencodeAgent &&
      !catalog.opencode.agents.some((agent) => agent.name === req.runConfig.opencodeAgent)
    ) {
      throw new Error("OpenCode agent is not available in the local OpenCode catalog.");
    }
  } else if (req.provider === "cursor") {
    const cursor = await loadCursorCatalog(runtime.cursor);
    const catalog = { ...EMPTY_PROVIDER_CATALOG, cursor };
    const model = findModel(req.runConfig.model, catalog);
    if (!cursor.available || !model || model.provider !== "cursor") {
      throw new Error(
        cursor.error ??
          "Cursor CLI agent is not available. Install the Cursor CLI, run agent login, then refresh providers.",
      );
    }
  } else {
    const model = findModel(req.runConfig.model);
    if (
      (!model || model.provider !== req.provider) &&
      !isCustomModelAllowed(req.provider, req.runConfig.model)
    ) {
      throw new Error("Model is not available for provider");
    }
  }
}

function sanitizeProviderRuntime(raw: ProviderRuntimeSettings | undefined): Required<ProviderRuntimeSettings> {
  return {
    claude: sanitizeProviderRuntimeConfig(raw?.claude),
    codex: sanitizeProviderRuntimeConfig(raw?.codex),
    opencode: sanitizeProviderRuntimeConfig(raw?.opencode),
    cursor: sanitizeProviderRuntimeConfig(raw?.cursor),
  };
}

function sanitizeProviderRuntimeConfig(raw: ProviderRuntimeConfig | undefined): ProviderRuntimeConfig {
  const out: ProviderRuntimeConfig = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    (out as Record<string, string>)[key] = trimmed;
  }
  return out;
}

function normalizeUserInputAnswers(
  answers: Record<string, string[]> | undefined,
  questions: UserInputQuestion[],
): Record<string, string[]> {
  const source = answers && typeof answers === "object" ? answers : {};
  const validIds = new Set(questions.map((question) => question.id));
  const out: Record<string, string[]> = {};
  for (const [id, values] of Object.entries(source)) {
    if (!validIds.has(id) || !Array.isArray(values)) continue;
    const normalized = normalizeStringList(values);
    if (normalized.length > 0) out[id] = normalized;
  }
  return out;
}

function normalizeStringList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function runProvider(
  req: SendPromptRequest,
  signal: AbortSignal,
  onEvent: (e: ChatEvent) => void,
  requestPermission?: (
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<"allow" | "deny">,
  requestUserInput?: (
    requestId: string,
    questions: UserInputQuestion[],
  ) => Promise<Record<string, string[]> | "reject">,
): Promise<void> {
  const runtime = sanitizeProviderRuntime(req.providerRuntime);
  if (req.provider === "claude") {
    await runClaude({
      prompt: req.prompt,
      cwd: req.cwd,
      resumeSessionId: req.resumeSessionId ?? null,
      runConfig: req.runConfig,
      signal,
      onEvent,
      requestPermission,
      runtime: runtime.claude,
    });
    return;
  }
  if (req.provider === "codex") {
    await runCodex({
      prompt: req.prompt,
      cwd: req.cwd,
      resumeSessionId: req.resumeSessionId ?? null,
      runConfig: req.runConfig,
      signal,
      onEvent,
      runtime: runtime.codex,
    });
    return;
  }
  if (req.provider === "opencode") {
    await runOpenCode({
      prompt: req.prompt,
      cwd: req.cwd,
      resumeSessionId: req.resumeSessionId ?? null,
      runConfig: req.runConfig,
      signal,
      onEvent,
      requestPermission,
      requestUserInput,
      runtime: runtime.opencode,
    });
    return;
  }
  if (req.provider === "cursor") {
    await runCursor({
      prompt: req.prompt,
      cwd: req.cwd,
      resumeSessionId: req.resumeSessionId ?? null,
      runConfig: req.runConfig,
      signal,
      onEvent,
      runtime: runtime.cursor,
    });
    return;
  }
  onEvent({
    kind: "error",
    message: `Unsupported provider "${req.provider}".`,
  });
}

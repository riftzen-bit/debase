import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannel } from "@shared/ipc";
import type {
  CancelPromptRequest,
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
  GitRemoveWorktreeRequest,
  GitRemoveWorktreeResponse,
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
  ProjectSearchFilesRequest,
  ProjectSearchFilesResponse,
  ReadScriptsRequest,
  ReadScriptsResponse,
  SaveImageRequest,
  SaveImageResponse,
  SendPromptRequest,
  SendPromptResponse,
  UserInputResponseRequest,
  WriteProjectFileRequest,
  WriteProjectFileResponse,
} from "@shared/chat";
import type { DebaseApi } from "@shared/api";
import type { ProviderCatalogRequest, ProviderCatalogResponse } from "@shared/providers";
import type {
  GitCloneRequest,
  GitCloneResponse,
  SourceControlCheckoutChangeRequestRequest,
  SourceControlCheckoutChangeRequestResponse,
  SourceControlCreateChangeRequestRequest,
  SourceControlCreateChangeRequestResponse,
  SourceControlListChangeRequestsRequest,
  SourceControlListChangeRequestsResponse,
  SourceControlOpenChangeRequestRequest,
  SourceControlOpenChangeRequestResponse,
  SourceControlPublishRepositoryRequest,
  SourceControlPublishRepositoryResponse,
  SourceControlScanRequest,
  SourceControlScanResponse,
} from "@shared/sourceControl";
import type {
  TerminalCloseRequest,
  TerminalEvent,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalResponse,
  TerminalRestartRequest,
  TerminalSessionRequest,
  TerminalWriteRequest,
} from "@shared/terminal";

const api: DebaseApi = {
  chat: {
    send(req: SendPromptRequest): Promise<SendPromptResponse> {
      return ipcRenderer.invoke(IpcChannel.ChatSend, req);
    },
    cancel(req: CancelPromptRequest): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.ChatCancel, req);
    },
    onEvent(cb: (env: ChatEventEnvelope) => void): () => void {
      const handler = (_event: IpcRendererEvent, payload: ChatEventEnvelope) => cb(payload);
      ipcRenderer.on(IpcChannel.ChatEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.ChatEvent, handler);
    },
    respondToPermission(req: PermissionResponseRequest): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.ChatPermissionResponse, req);
    },
    respondToUserInput(req: UserInputResponseRequest): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.ChatUserInputResponse, req);
    },
  },
  terminal: {
    open(req: TerminalOpenRequest): Promise<TerminalResponse> {
      return ipcRenderer.invoke(IpcChannel.TerminalOpen, req);
    },
    write(req: TerminalWriteRequest): Promise<TerminalResponse> {
      return ipcRenderer.invoke(IpcChannel.TerminalWrite, req);
    },
    resize(req: TerminalResizeRequest): Promise<TerminalResponse> {
      return ipcRenderer.invoke(IpcChannel.TerminalResize, req);
    },
    clear(req: TerminalSessionRequest): Promise<TerminalResponse> {
      return ipcRenderer.invoke(IpcChannel.TerminalClear, req);
    },
    restart(req: TerminalRestartRequest): Promise<TerminalResponse> {
      return ipcRenderer.invoke(IpcChannel.TerminalRestart, req);
    },
    close(req: TerminalCloseRequest): Promise<TerminalResponse> {
      return ipcRenderer.invoke(IpcChannel.TerminalClose, req);
    },
    onEvent(cb: (event: TerminalEvent) => void): () => void {
      const handler = (_event: IpcRendererEvent, payload: TerminalEvent) => cb(payload);
      ipcRenderer.on(IpcChannel.TerminalEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannel.TerminalEvent, handler);
    },
  },
  env: {
    get(): Promise<EnvironmentInfo> {
      return ipcRenderer.invoke(IpcChannel.EnvGet);
    },
  },
  providers: {
    list(req?: ProviderCatalogRequest): Promise<ProviderCatalogResponse> {
      return ipcRenderer.invoke(IpcChannel.ProvidersList, req);
    },
  },
  dialog: {
    chooseDirectory(): Promise<ChooseDirectoryResponse> {
      return ipcRenderer.invoke(IpcChannel.DialogChooseDirectory);
    },
    chooseFiles(req?: ChooseFilesRequest): Promise<ChooseFilesResponse> {
      return ipcRenderer.invoke(IpcChannel.DialogChooseFiles, req);
    },
  },
  shell: {
    openPath(path: string): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.ShellOpenPath, path);
    },
    openInEditor(req: OpenInEditorRequest): Promise<OpenInEditorResponse> {
      return ipcRenderer.invoke(IpcChannel.ShellOpenInEditor, req);
    },
  },
  project: {
    readScripts(req: ReadScriptsRequest): Promise<ReadScriptsResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectReadScripts, req);
    },
    writeFile(req: WriteProjectFileRequest): Promise<WriteProjectFileResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectWriteFile, req);
    },
    searchFiles(req: ProjectSearchFilesRequest): Promise<ProjectSearchFilesResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSearchFiles, req);
    },
    listSkills(req?: ProjectListSkillsRequest): Promise<ProjectListSkillsResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectListSkills, req);
    },
    gitStatus(req: GitStatusRequest): Promise<GitStatusResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitStatus, req);
    },
    gitDiff(req: GitDiffRequest): Promise<GitDiffResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitDiff, req);
    },
    gitListRefs(req: GitListRefsRequest): Promise<GitListRefsResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitListRefs, req);
    },
    gitSwitchRef(req: GitSwitchRefRequest): Promise<GitSwitchRefResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitSwitchRef, req);
    },
    gitCreateRef(req: GitCreateRefRequest): Promise<GitCreateRefResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitCreateRef, req);
    },
    gitCreateWorktree(req: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitCreateWorktree, req);
    },
    gitRemoveWorktree(req: GitRemoveWorktreeRequest): Promise<GitRemoveWorktreeResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitRemoveWorktree, req);
    },
    sourceControlScan(req?: SourceControlScanRequest): Promise<SourceControlScanResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSourceControlScan, req);
    },
    gitClone(req: GitCloneRequest): Promise<GitCloneResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectGitClone, req);
    },
    sourceControlListChangeRequests(
      req: SourceControlListChangeRequestsRequest,
    ): Promise<SourceControlListChangeRequestsResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSourceControlListChangeRequests, req);
    },
    sourceControlOpenChangeRequest(
      req: SourceControlOpenChangeRequestRequest,
    ): Promise<SourceControlOpenChangeRequestResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSourceControlOpenChangeRequest, req);
    },
    sourceControlCheckoutChangeRequest(
      req: SourceControlCheckoutChangeRequestRequest,
    ): Promise<SourceControlCheckoutChangeRequestResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSourceControlCheckoutChangeRequest, req);
    },
    sourceControlCreateChangeRequest(
      req: SourceControlCreateChangeRequestRequest,
    ): Promise<SourceControlCreateChangeRequestResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSourceControlCreateChangeRequest, req);
    },
    sourceControlPublishRepository(
      req: SourceControlPublishRepositoryRequest,
    ): Promise<SourceControlPublishRepositoryResponse> {
      return ipcRenderer.invoke(IpcChannel.ProjectSourceControlPublishRepository, req);
    },
    bootstrapAllowlist(paths: string[]): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.ProjectsBootstrap, paths);
    },
  },
  attachments: {
    saveImage(req: SaveImageRequest): Promise<SaveImageResponse> {
      return ipcRenderer.invoke(IpcChannel.AttachmentsSaveImage, req);
    },
  },
  keybindings: {
    load(): Promise<KeybindingsLoadResponse> {
      return ipcRenderer.invoke(IpcChannel.KeybindingsLoad);
    },
    save(req: KeybindingsSaveRequest): Promise<KeybindingsSaveResponse> {
      return ipcRenderer.invoke(IpcChannel.KeybindingsSave, req);
    },
    revealFile(): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.KeybindingsRevealFile);
    },
  },
  window: {
    minimize(): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.WindowMinimize);
    },
    maximize(): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.WindowMaximize);
    },
    close(): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.WindowClose);
    },
    isMaximized(): Promise<boolean> {
      return ipcRenderer.invoke(IpcChannel.WindowIsMaximized);
    },
    onMaximizeChange(cb: (isMax: boolean) => void): () => void {
      const handler = (_event: IpcRendererEvent, isMax: boolean) => cb(isMax);
      ipcRenderer.on(IpcChannel.WindowMaximizeChange, handler);
      return () => ipcRenderer.removeListener(IpcChannel.WindowMaximizeChange, handler);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);

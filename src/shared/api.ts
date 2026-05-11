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
} from "./chat";
import type { ProviderCatalogRequest, ProviderCatalogResponse } from "./providers";
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
} from "./sourceControl";
import type {
  TerminalCloseRequest,
  TerminalEvent,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalResponse,
  TerminalRestartRequest,
  TerminalSessionRequest,
  TerminalWriteRequest,
} from "./terminal";

export type DebaseApi = {
  chat: {
    send(req: SendPromptRequest): Promise<SendPromptResponse>;
    cancel(req: CancelPromptRequest): Promise<void>;
    onEvent(cb: (env: ChatEventEnvelope) => void): () => void;
    respondToPermission(req: PermissionResponseRequest): Promise<void>;
    respondToUserInput(req: UserInputResponseRequest): Promise<void>;
  };
  terminal: {
    open(req: TerminalOpenRequest): Promise<TerminalResponse>;
    write(req: TerminalWriteRequest): Promise<TerminalResponse>;
    resize(req: TerminalResizeRequest): Promise<TerminalResponse>;
    clear(req: TerminalSessionRequest): Promise<TerminalResponse>;
    restart(req: TerminalRestartRequest): Promise<TerminalResponse>;
    close(req: TerminalCloseRequest): Promise<TerminalResponse>;
    onEvent(cb: (event: TerminalEvent) => void): () => void;
  };
  env: {
    get(): Promise<EnvironmentInfo>;
  };
  providers: {
    list(req?: ProviderCatalogRequest): Promise<ProviderCatalogResponse>;
  };
  dialog: {
    chooseDirectory(): Promise<ChooseDirectoryResponse>;
    chooseFiles(req?: ChooseFilesRequest): Promise<ChooseFilesResponse>;
  };
  shell: {
    openPath(path: string): Promise<void>;
    openInEditor(req: OpenInEditorRequest): Promise<OpenInEditorResponse>;
  };
  project: {
    readScripts(req: ReadScriptsRequest): Promise<ReadScriptsResponse>;
    writeFile(req: WriteProjectFileRequest): Promise<WriteProjectFileResponse>;
    searchFiles(req: ProjectSearchFilesRequest): Promise<ProjectSearchFilesResponse>;
    listSkills(req?: ProjectListSkillsRequest): Promise<ProjectListSkillsResponse>;
    gitStatus(req: GitStatusRequest): Promise<GitStatusResponse>;
    gitDiff(req: GitDiffRequest): Promise<GitDiffResponse>;
    gitListRefs(req: GitListRefsRequest): Promise<GitListRefsResponse>;
    gitSwitchRef(req: GitSwitchRefRequest): Promise<GitSwitchRefResponse>;
    gitCreateRef(req: GitCreateRefRequest): Promise<GitCreateRefResponse>;
    gitCreateWorktree(req: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResponse>;
    gitRemoveWorktree(req: GitRemoveWorktreeRequest): Promise<GitRemoveWorktreeResponse>;
    sourceControlScan(req?: SourceControlScanRequest): Promise<SourceControlScanResponse>;
    gitClone(req: GitCloneRequest): Promise<GitCloneResponse>;
    sourceControlListChangeRequests(
      req: SourceControlListChangeRequestsRequest,
    ): Promise<SourceControlListChangeRequestsResponse>;
    sourceControlOpenChangeRequest(
      req: SourceControlOpenChangeRequestRequest,
    ): Promise<SourceControlOpenChangeRequestResponse>;
    sourceControlCheckoutChangeRequest(
      req: SourceControlCheckoutChangeRequestRequest,
    ): Promise<SourceControlCheckoutChangeRequestResponse>;
    sourceControlCreateChangeRequest(
      req: SourceControlCreateChangeRequestRequest,
    ): Promise<SourceControlCreateChangeRequestResponse>;
    sourceControlPublishRepository(
      req: SourceControlPublishRepositoryRequest,
    ): Promise<SourceControlPublishRepositoryResponse>;
    /**
     * Imports the renderer-side project paths into the main-process allowlist.
     * Idempotent within a launch — see `src/main/security.ts`.
     */
    bootstrapAllowlist(paths: string[]): Promise<void>;
  };
  attachments: {
    saveImage(req: SaveImageRequest): Promise<SaveImageResponse>;
  };
  keybindings: {
    load(): Promise<KeybindingsLoadResponse>;
    save(req: KeybindingsSaveRequest): Promise<KeybindingsSaveResponse>;
    revealFile(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(cb: (isMax: boolean) => void): () => void;
  };
};

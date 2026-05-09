import type {
  CancelPromptRequest,
  ChatEventEnvelope,
  ChooseDirectoryResponse,
  ChooseFilesRequest,
  ChooseFilesResponse,
  EnvironmentInfo,
  OpenInEditorRequest,
  OpenInEditorResponse,
  KeybindingsLoadResponse,
  KeybindingsSaveRequest,
  KeybindingsSaveResponse,
  PermissionResponseRequest,
  ReadScriptsRequest,
  ReadScriptsResponse,
  SaveImageRequest,
  SaveImageResponse,
  SendPromptRequest,
  SendPromptResponse,
} from "./chat";

export type DebaseApi = {
  chat: {
    send(req: SendPromptRequest): Promise<SendPromptResponse>;
    cancel(req: CancelPromptRequest): Promise<void>;
    onEvent(cb: (env: ChatEventEnvelope) => void): () => void;
    respondToPermission(req: PermissionResponseRequest): Promise<void>;
  };
  env: {
    get(): Promise<EnvironmentInfo>;
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

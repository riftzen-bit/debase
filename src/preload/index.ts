import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannel } from "@shared/ipc";
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
} from "@shared/chat";
import type { DebaseApi } from "@shared/api";

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
  },
  env: {
    get(): Promise<EnvironmentInfo> {
      return ipcRenderer.invoke(IpcChannel.EnvGet);
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

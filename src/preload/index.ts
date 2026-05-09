import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannel } from "@shared/ipc";
import type {
  CancelPromptRequest,
  ChatEventEnvelope,
  ChooseDirectoryResponse,
  EnvironmentInfo,
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
  },
  shell: {
    openPath(path: string): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.ShellOpenPath, path);
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

import type {
  CancelPromptRequest,
  ChatEventEnvelope,
  ChooseDirectoryResponse,
  EnvironmentInfo,
  SendPromptRequest,
  SendPromptResponse,
} from "./chat";

export type DebaseApi = {
  chat: {
    send(req: SendPromptRequest): Promise<SendPromptResponse>;
    cancel(req: CancelPromptRequest): Promise<void>;
    onEvent(cb: (env: ChatEventEnvelope) => void): () => void;
  };
  env: {
    get(): Promise<EnvironmentInfo>;
  };
  dialog: {
    chooseDirectory(): Promise<ChooseDirectoryResponse>;
  };
  shell: {
    openPath(path: string): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(cb: (isMax: boolean) => void): () => void;
  };
};

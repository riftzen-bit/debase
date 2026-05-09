export const IpcChannel = {
  ChatSend: "chat:send",
  ChatCancel: "chat:cancel",
  ChatEvent: "chat:event",
  EnvGet: "env:get",
  DialogChooseDirectory: "dialog:choose-directory",
  ShellOpenPath: "shell:open-path",
  WindowMinimize: "window:minimize",
  WindowMaximize: "window:maximize",
  WindowClose: "window:close",
  WindowIsMaximized: "window:is-maximized",
  WindowMaximizeChange: "window:maximize-change",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

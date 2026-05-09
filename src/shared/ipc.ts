export const IpcChannel = {
  ChatSend: "chat:send",
  ChatCancel: "chat:cancel",
  ChatEvent: "chat:event",
  EnvGet: "env:get",
  DialogChooseDirectory: "dialog:choose-directory",
  DialogChooseFiles: "dialog:choose-files",
  ShellOpenPath: "shell:open-path",
  ShellOpenInEditor: "shell:open-in-editor",
  ProjectReadScripts: "project:read-scripts",
  AttachmentsSaveImage: "attachments:save-image",
  KeybindingsLoad: "keybindings:load",
  KeybindingsSave: "keybindings:save",
  KeybindingsRevealFile: "keybindings:reveal-file",
  ChatPermissionResponse: "chat:permission-response",
  ProjectsBootstrap: "projects:bootstrap-allowlist",
  WindowMinimize: "window:minimize",
  WindowMaximize: "window:maximize",
  WindowClose: "window:close",
  WindowIsMaximized: "window:is-maximized",
  WindowMaximizeChange: "window:maximize-change",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

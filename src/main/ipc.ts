import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type WebContents,
} from "electron";
import { homedir, platform } from "node:os";
import { runClaude } from "./agent/claude";
import { IpcChannel } from "@shared/ipc";
import type {
  CancelPromptRequest,
  ChatEvent,
  ChatEventEnvelope,
  ChooseDirectoryResponse,
  EnvironmentInfo,
  SendPromptRequest,
  SendPromptResponse,
} from "@shared/chat";

const inflight = new Map<string, AbortController>();

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    IpcChannel.ChatSend,
    async (_event, raw: SendPromptRequest): Promise<SendPromptResponse> => {
      try {
        validateSendRequest(raw);
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

      runProvider(raw, controller.signal, emit)
        .catch((err) => {
          emit({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          inflight.delete(requestId);
        });

      return { ok: true, requestId };
    },
  );

  ipcMain.handle(IpcChannel.ChatCancel, async (_event, raw: CancelPromptRequest) => {
    const ctrl = inflight.get(raw.requestId);
    if (ctrl) {
      ctrl.abort();
      inflight.delete(raw.requestId);
    }
  });

  ipcMain.handle(IpcChannel.EnvGet, async (): Promise<EnvironmentInfo> => {
    return {
      platform: platform(),
      homeDir: homedir(),
      defaultCwd: homedir(),
      appVersion: app.getVersion(),
      hasAnthropicEnvKey: Boolean(process.env.ANTHROPIC_API_KEY),
    };
  });

  ipcMain.handle(
    IpcChannel.DialogChooseDirectory,
    async (): Promise<ChooseDirectoryResponse> => {
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
        return { ok: true, path: result.filePaths[0]! };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(IpcChannel.ShellOpenPath, async (_event, p: string) => {
    if (typeof p === "string" && p.length > 0) {
      await shell.openPath(p);
    }
  });

  registerWindowHandlers(getWindow);
}

function registerWindowHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IpcChannel.WindowMinimize, () => {
    getWindow()?.minimize();
  });

  ipcMain.handle(IpcChannel.WindowMaximize, () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IpcChannel.WindowClose, () => {
    getWindow()?.close();
  });

  ipcMain.handle(IpcChannel.WindowIsMaximized, (): boolean => {
    return getWindow()?.isMaximized() ?? false;
  });
}

export function broadcastMaximizeChange(wc: WebContents, isMax: boolean): void {
  if (wc.isDestroyed()) return;
  wc.send(IpcChannel.WindowMaximizeChange, isMax);
}

function validateSendRequest(req: SendPromptRequest): void {
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
  if (req.provider !== "claude" && req.provider !== "codex" && req.provider !== "opencode") {
    throw new Error("Unknown provider");
  }
  if (!req.runConfig || typeof req.runConfig !== "object") {
    throw new Error("Missing runConfig");
  }
  if (typeof req.runConfig.model !== "string" || req.runConfig.model.length === 0) {
    throw new Error("Missing model");
  }
}

async function runProvider(
  req: SendPromptRequest,
  signal: AbortSignal,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  if (req.provider === "claude") {
    await runClaude({
      prompt: req.prompt,
      cwd: req.cwd,
      resumeSessionId: req.resumeSessionId ?? null,
      runConfig: req.runConfig,
      signal,
      onEvent,
    });
    return;
  }
  onEvent({
    kind: "error",
    message: `Provider "${req.provider}" is not yet wired up. Enable it in Settings once available.`,
  });
}

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
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { basename, extname, join, resolve as resolvePath } from "node:path";
import { homedir, platform } from "node:os";
import { runClaude } from "./agent/claude";
import {
  addProjectRoot,
  bootstrapAllowlist,
  isInsideAllowedRoot,
} from "./security";
import { IpcChannel } from "@shared/ipc";
import type {
  CancelPromptRequest,
  ChatEvent,
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

const inflight = new Map<string, AbortController>();

// Active permission prompts. Keyed by `permId` (renderer-visible identifier),
// each entry holds the resolver that the SDK's canUseTool is awaiting plus
// the requestId so we can mass-resolve when a turn is cancelled.
type PermSlot = {
  resolve: (decision: "allow" | "deny") => void;
  requestId: string;
};
const pendingPerms = new Map<string, PermSlot>();

// Threads the user has confirmed for `bypassPermissions` mode this session.
// The set is intentionally in-memory only — restart the app and the warning
// dialog fires again, so a thread persisted with `fullAccess: true` never
// runs silently the next launch.
const confirmedFullAccess = new Set<string>();

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

      if (raw.runConfig.fullAccess) {
        const confirmed = await ensureFullAccessConfirmed(raw.threadId, win);
        if (!confirmed) {
          return { ok: false, error: "Full access not confirmed" };
        }
      }

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

      const requestPermission = raw.askBeforeTools
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

      runProvider(raw, controller.signal, emit, requestPermission)
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
    IpcChannel.KeybindingsLoad,
    async (event): Promise<KeybindingsLoadResponse> => {
      if (!fromMain(event)) {
        return { ok: false, error: "Unauthorized sender", path: "" };
      }
      const path = keybindingsPath();
      try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        const overrides = sanitizeOverrides(parsed);
        return { ok: true, overrides, path };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          // First-time use — return empty overrides without surfacing as an
          // error to the renderer.
          return { ok: true, overrides: {}, path };
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
        const overrides = sanitizeOverrides(req?.overrides ?? {});
        await writeFile(path, JSON.stringify(overrides, null, 2) + "\n", "utf8");
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
      await writeFile(path, "{}\n", "utf8");
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

async function ensureFullAccessConfirmed(
  threadId: string,
  win: BrowserWindow,
): Promise<boolean> {
  if (confirmedFullAccess.has(threadId)) return true;
  // showMessageBox is synchronous from the user's perspective — they have
  // to click before the run starts, so a renderer compromise can't
  // race-stuff this past them. We intentionally default the highlighted
  // button to Cancel so muscle-memory Enter doesn't auto-allow.
  const result = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Allow full access?",
    message: "This thread is set to bypass permission prompts.",
    detail:
      "Claude will run shell commands, edit files, and use tools without asking. " +
      "Approve only if you trust the prompt and the working directory.\n\n" +
      "debase will ask again after the next app restart.",
    buttons: ["Cancel", "Allow this session"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (result.response !== 1) return false;
  confirmedFullAccess.add(threadId);
  return true;
}

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
  if (req.provider !== "claude" && req.provider !== "codex" && req.provider !== "opencode") {
    throw new Error("Unknown provider");
  }
  if (!req.runConfig || typeof req.runConfig !== "object") {
    throw new Error("Missing runConfig");
  }
  if (typeof req.runConfig.model !== "string" || req.runConfig.model.length === 0) {
    throw new Error("Missing model");
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
): Promise<void> {
  if (req.provider === "claude") {
    await runClaude({
      prompt: req.prompt,
      cwd: req.cwd,
      resumeSessionId: req.resumeSessionId ?? null,
      runConfig: req.runConfig,
      signal,
      onEvent,
      requestPermission,
    });
    return;
  }
  onEvent({
    kind: "error",
    message: `Provider "${req.provider}" is not yet wired up. Enable it in Settings once available.`,
  });
}

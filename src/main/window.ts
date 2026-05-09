import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { broadcastMaximizeChange } from "./ipc";

function appIconPath(): string {
  // out/main/index.cjs lives two levels under the project root in dev and
  // inside the asar in production — `resources/` sits at the same depth in
  // both, so this single relative resolve works for both.
  const file = process.platform === "win32" ? "icon.ico" : "tray.png";
  return join(__dirname, "../../resources", file);
}

export function createMainWindow(): BrowserWindow {
  console.log("[debase] createMainWindow start");
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: true,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: "#faf7ef",
    icon: appIconPath(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? {
            color: "#faf7ef",
            symbolColor: "#5b574c",
            height: 36,
          }
        : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      // sandbox: true means the renderer process gets full OS sandboxing
      // (chromium-style) and the preload script only sees the limited
      // Electron APIs whitelisted for sandboxed preloads. Our preload
      // imports nothing else — verified via grep — so the bridge keeps
      // working while a renderer XSS no longer has Node primitives at all.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => {
    console.log("[debase] ready-to-show — showing window");
    win.show();
    win.focus();
  });

  win.webContents.on("did-finish-load", () => {
    console.log("[debase] renderer did-finish-load");
  });

  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    console.error(
      `[debase] renderer did-fail-load code=${errorCode} ${errorDescription} url=${validatedURL}`,
    );
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[debase] renderer process gone:", details);
  });

  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error("[debase] preload error at", preloadPath, ":", error);
  });

  win.on("maximize", () => broadcastMaximizeChange(win.webContents, true));
  win.on("unmaximize", () => broadcastMaximizeChange(win.webContents, false));

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only forward navigations to the OS that we're confident the user
    // expects: https sites and mailto links. http:// is dropped because
    // we don't want to act as a redirector to insecure pages, and
    // anything more exotic (file:, data:, javascript:) is silently denied.
    if (url.startsWith("https://") || url.startsWith("mailto:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    console.log("[debase] loading URL:", process.env["ELECTRON_RENDERER_URL"]);
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    const filePath = join(__dirname, "../renderer/index.html");
    console.log("[debase] loading file:", filePath);
    win.loadFile(filePath);
  }

  return win;
}

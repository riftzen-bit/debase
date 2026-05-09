import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { broadcastMaximizeChange } from "./ipc";

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
      sandbox: false,
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
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
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

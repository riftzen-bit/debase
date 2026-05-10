import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";
import { registerIpcHandlers } from "./ipc";

// Some Windows/sandboxed environments cannot start Chromium's GPU process
// reliably (`GPU process isn't usable. Goodbye.`). The UI is 2D, so disabling
// acceleration is fine; `in-process-gpu` handles the Electron/Chromium case
// where a separate GPU subprocess still fails before the renderer can load.
app.disableHardwareAcceleration();
if (process.platform === "win32") {
  app.commandLine.appendSwitch("in-process-gpu");
}

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

app.whenReady().then(() => {
  registerIpcHandlers(getMainWindow);
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const url = new URL(navigationUrl);
    if (url.origin !== "http://localhost:5173" && url.protocol !== "file:") {
      event.preventDefault();
    }
  });
});

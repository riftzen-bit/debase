// Spawns electron-vite with ELECTRON_RUN_AS_NODE removed.
// Some toolchains set this env var to use Electron's binary as Node;
// it must be absent for the actual Electron app to start.
const { spawn } = require("node:child_process");
const path = require("node:path");

const mode = process.argv[2];
if (!mode) {
  console.error("usage: node scripts/launch.cjs <dev|preview|build>");
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const isWin = process.platform === "win32";
const binDir = path.resolve(__dirname, "..", "node_modules", ".bin");
const fs = require("node:fs");

function resolveBin(base) {
  const candidates = isWin
    ? [base + ".exe", base + ".cmd", base + ".bat", base]
    : [base];
  for (const name of candidates) {
    const full = path.join(binDir, name);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(`Could not locate ${base} in ${binDir}`);
}

const cmd = resolveBin("electron-vite");

const child = spawn(cmd, [mode], {
  stdio: "inherit",
  env,
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("[launch.cjs] failed to start electron-vite:", err.message);
  process.exit(1);
});

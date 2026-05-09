# debase

Desktop GUI shell that wraps the Claude Code CLI (and, eventually, Codex and
OpenCode) into one Electron app. The agent's behavior is left untouched —
debase is a thin UI layer, not a re-implementation. Threads are organized by
project, and each project's path becomes the agent's working directory.

Currently shipping with the Claude provider only. Codex and OpenCode appear
in the Settings → Providers list as placeholders; their toggles unlock when
their CLI bridges land.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 — used as the package manager and dev runner.
- Node 20+ (only needed if Bun's electron postinstall is skipped — see below).
- The [`claude`](https://docs.claude.com/en/docs/claude-code/setup) CLI,
  logged in. debase reuses your existing `claude` login through the
  Claude Agent SDK; it does not ask for an API key.
- Windows 10+, macOS 12+, or Linux (X11 / Wayland). Tested primarily on
  Windows 11.

## Quick start

```bash
# clone
git clone https://github.com/<your-fork>/debase.git
cd debase

# install
bun install

# (Bun-only fix) if `node_modules/electron/dist/` is missing after install,
# Bun skipped Electron's postinstall — run it manually once:
node node_modules/electron/install.js

# dev (HMR + Electron, hot reload)
bun run dev
```

A window titled "debase" should appear within a few seconds. Click
"Choose a folder", point at any repository, then "New thread" and start
prompting.

## Available scripts

| script | what it does |
|---|---|
| `bun run dev` | Vite dev server + Electron with HMR. |
| `bun run build` | Bundle main → `out/main`, preload → `out/preload`, renderer → `out/renderer`. Required before `start`. |
| `bun run start` | Run the production bundle (alias of `preview`). |
| `bun run typecheck` | `tsc --noEmit` for both the Node-side and Web-side configs. |
| `bun run package` | `electron-vite build` + `electron-builder` — produces an installer for the host platform under `release/<version>/`. |
| `bun run package:dir` | Same as `package` but stops at the unpacked app dir (faster, no installer). |

`dev`, `start`, and `preview` go through `scripts/launch.cjs` — see Gotchas.

## Gotchas

- **`ELECTRON_RUN_AS_NODE` must NOT be set.** Some toolchains export this so
  Electron's binary can run as a plain Node runtime. If it leaks into the
  app's environment, Electron starts in Node-only mode, `process.type`
  becomes `undefined`, and `require("electron")` returns a path string
  instead of the API. `scripts/launch.cjs` deletes it from the spawn env;
  always launch via the npm scripts, never `electron .` directly.
- **Bun + Electron postinstall.** `bun install` may not run the `electron`
  package's `install.js` automatically. If `node_modules/electron/dist/` is
  empty after install, run `node node_modules/electron/install.js` once to
  fetch the binary.
- **Vite is pinned at 7.x.** `@vitejs/plugin-react@4` and `electron-vite@5`
  peer-require Vite ≤ 7. Bumping to Vite 8 will break the build.
- **The Claude SDK is ESM-only**, but the main bundle is CJS. The SDK is
  loaded via dynamic `await import(...)` in `src/main/agent/claude.ts`. Do
  not switch back to a static import — it would compile to `require()` and
  fail with `ERR_REQUIRE_ESM`.
- **Linux window controls.** On Linux the OS title bar is hidden and there
  are no in-app min/max/close buttons. Windows and macOS use the native
  overlay; Linux support is not yet wired.

## Stack

- Electron 33 (downgraded from 42 — bundled Node 20 needed for the SDK)
- electron-vite 5 (Vite 7)
- React 19 + TypeScript 5 + Tailwind CSS 4
- `@anthropic-ai/claude-agent-sdk`
- Geist Sans + JetBrains Mono

See `CLAUDE.md` for project conventions, the warm-paper visual identity, and
the full bug log.

## Where state lives

- App state (projects, threads, messages, run config, defaults) is stored
  in the renderer's `localStorage` under `debase.state.v2`. There is no
  server, no telemetry, and no cloud sync. Wipe state by clearing the app's
  IndexedDB / localStorage in DevTools or by deleting the user-data folder
  Electron creates for the app.
- The `claude` CLI keeps its own login under your home directory; debase
  doesn't touch it.

## Status

This is a personal tool. Bug reports and PRs are welcome but support is
best-effort.

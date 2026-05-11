# debase

Desktop GUI shell that wraps Claude Code, OpenAI Codex, OpenCode, and Cursor CLI
into one Electron app.
The agent's behavior is left untouched —
debase is a thin UI layer, not a re-implementation. Threads are organized by
project, and each project's path becomes the agent's working directory.

Currently shipping with Claude, Codex, OpenCode, and Cursor providers. Each
provider reuses that tool's own local login. OpenCode models are discovered at
runtime from the user's local `opencode` CLI; Cursor models are discovered from
the local authenticated `agent` command. debase does not show OpenCode or Cursor
models unless the matching local CLI reports that it is available.

For Git projects, debase also shows the active branch, upstream, ahead/behind
state, and dirty-file counts directly under the chat header so a coding-agent
turn stays anchored to the checkout it is editing. The dirty-file popover can
open a read-only unified diff for each changed file. Threads can also create a
branch from the current checkout, switch refs, or create a dedicated git
worktree from a selected base ref and switch their cwd to it.

The full diff panel opens with `Ctrl/Cmd+D` (or `/diff`) when the terminal is
not focused. It reads the same git status/diff IPC as the status bar, supports
per-file or whole-working-tree views, and becomes a full-width sheet on narrow
viewports.

Settings includes a Source control page that scans the active checkout's git
remotes and local provider auth. It detects GitHub, GitLab, Bitbucket, and
Azure DevOps setup state before publish or review flows mutate git state.
Settings also includes a Diagnostics page that reads live environment,
provider-catalog, local-skill, keybinding, and source-control health through
the same IPC paths used by the app. Its snapshot button copies those checks as
JSON for bug reports.
Archived threads can be reviewed from Settings > Archived, where they can be
opened, restored to their project, or deleted.
The command palette can open Settings subsections directly, including
Providers, Source control, Archived, Diagnostics, and Shortcuts.
The Shortcuts page has an in-page filter for command names, descriptions,
keys, scopes, and `when` clauses before remapping a binding. It can also add
or delete raw `{ "key", "command", "when" }` rules for command-specific
shortcuts that do not fit a single default row. `Ctrl/Cmd+O` opens the active
thread cwd in the configured editor.
The command palette can also clone a Git URL/local path, GitHub `owner/repo`,
GitLab `group/project`, Bitbucket `workspace/repository`, or Azure DevOps
`project/repository` into a selected folder and add the new checkout as a
debase project. Hosted repository lookup uses the user's authenticated local
provider setup on the machine running debase.

The model picker opens with `Ctrl/Cmd+Shift+M` or `/model`. It searches across
all enabled providers that are actually available, so OpenCode and Cursor
entries only appear when their local CLI catalogs report usable auth. Settings
can favorite or hide models per provider, and Claude/Codex can add custom model
slugs. OpenCode and Cursor intentionally cannot add custom slugs; they only show
models reported by the user's local CLI.

Provider settings also expose the runtime paths used by the local tools:
Claude has `binaryPath`, `homePath`, and launch args; Codex has `binaryPath`,
`homePath`, and `shadowHomePath`; OpenCode has `binaryPath`, `serverUrl`, and
`serverPassword`; Cursor has `binaryPath` and `apiEndpoint`. These settings
only point debase at the user's installed, logged-in tools. They do not create
accounts, add fallback catalogs, or unlock OpenCode/Cursor models that the local
CLI cannot report.

The composer supports `/` commands, `@` file mentions, and `$` skill mentions.
Typing `@foo` searches the active thread cwd and inserts a relative `@path`;
typing `$review` searches installed local skills from the user's Codex/Agents
and project skill roots, then inserts the literal `$skill-name` token.

Plan-mode replies open a right-side Plan panel automatically. The same panel
opens with `Ctrl/Cmd+Shift+L`, `/plans`, or the composer `plan` toggle. It
shows the latest plan-mode markdown, can copy/download it, save it into the
active thread workspace, and send an implementation prompt back to the thread.

Each thread can open a real PTY terminal drawer with `Ctrl/Cmd+J`. The terminal
uses the same cwd/worktree as the active thread, streams through Electron IPC,
and is rendered with xterm rather than a fake command-output panel. When the
terminal has focus, `Ctrl/Cmd+D` splits, `Ctrl/Cmd+N` opens another pane,
and `Ctrl/Cmd+W` closes the active pane without toggling diff or archiving chat
threads. The terminal toolbar can attach the active selection, or the last
visible output when nothing is selected, into the composer as a terminal-context
chip that is sent with the next prompt.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 — used as the package manager and dev runner.
- Node 20+ (only needed if Bun's electron postinstall is skipped — see below).
- The [`claude`](https://docs.claude.com/en/docs/claude-code/setup) CLI,
  logged in. debase reuses your existing `claude` login through the
  Claude Agent SDK; it does not ask for an API key.
- The `codex` CLI, logged in, if you want to run OpenAI Codex threads.
- The `opencode` CLI, logged in with `opencode auth login`, if you want to run
  OpenCode threads. On Windows, npm-installed `opencode.cmd` also needs
  `node.exe`; debase resolves the common npm and Node install folders before
  starting `opencode serve`.
- The Cursor CLI `agent` command, logged in, if you want to run Cursor threads.
  debase intentionally does not use `cursor.cmd agent` as a substitute; the
  official `agent` command must exist on PATH or in Cursor's install folders.
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
- **Window controls.** Windows uses Electron's native titlebar overlay, macOS
  uses hidden-inset traffic lights, and Linux renders in-app
  minimize/maximize/close controls because the OS title bar is hidden.

## Stack

- Electron 33 (downgraded from 42 — bundled Node 20 needed for the SDK)
- electron-vite 5 (Vite 7)
- React 19 + TypeScript 5 + Tailwind CSS 4
- `@anthropic-ai/claude-agent-sdk`, Codex CLI, `@opencode-ai/sdk`, Cursor CLI
- `node-pty` + `@xterm/xterm` for the per-thread terminal drawer
- Geist Sans + JetBrains Mono

See `CLAUDE.md` for project conventions, the warm-paper visual identity, and
the full bug log.

## Where state lives

- App state (projects, threads, messages, run config, defaults) is stored
  in the renderer's `localStorage` under `debase.state.v2`. There is no
  server, no telemetry, and no cloud sync. Wipe state by clearing the app's
  IndexedDB / localStorage in DevTools or by deleting the user-data folder
  Electron creates for the app.
- Keybindings live in Electron's user-data folder as `keybindings.json`. The
  preferred shape is the t3code-style array of `{ "key", "command", "when" }`
  rules; `when` currently supports `terminalFocus`, `terminalOpen`,
  `modelPickerOpen`, `!`, `&&`, `||`, and parentheses.
- The `claude`, `codex`, `opencode`, and Cursor `agent` CLIs keep their own
  logins under your home directory; debase doesn't touch them.

## Status

This is a personal tool. Bug reports and PRs are welcome but support is
best-effort.

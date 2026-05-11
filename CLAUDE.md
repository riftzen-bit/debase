# debase

## Purpose

Desktop GUI shell that wraps multiple AI coding CLIs (Claude Code, Codex, OpenCode, Cursor CLI) into one interface. Inspired by t3.codes / pingdotgg/t3code in scope, but a self-contained Electron app rather than a hosted web UI.

Currently shipping with **Claude**, **Codex**, **OpenCode**, and **Cursor CLI** providers. Each provider reuses that tool's own local login. OpenCode models are runtime-discovered from the user's local `opencode` CLI and Cursor models are runtime-discovered from the user's authenticated `agent` command. Catalog-only providers only appear when their local CLI reports usable auth.

## Stack

- Runtime / shell: **Electron 33** (downgraded from 42 — see Gotchas)
- Build: **electron-vite 5** (Vite 7 under the hood)
- UI: **React 19 + TypeScript 5 + Tailwind CSS 4**
- Markdown: `react-markdown` + `remark-gfm` + `rehype-highlight` (highlight.js theme: github-dark-dimmed)
- Fonts: `@fontsource/geist-sans` (display + body), `@fontsource/jetbrains-mono` (composer + code)
- Agents: `@anthropic-ai/claude-agent-sdk`, Codex CLI, `@opencode-ai/sdk`, Cursor CLI `agent` (SDKs loaded via dynamic import — main bundle is CJS)
- Terminal: `node-pty` in the main process, `@xterm/xterm` + fit addon in the renderer
- Package manager: **bun** (per global rules)

## Commands

All run from the project root.

- `bun install` — install deps. **Postinstall is required**: if `node_modules/electron/dist/electron.exe` is missing after install, run `node node_modules/electron/install.js` to fetch the binary (Bun sometimes skips this).
- `bun run typecheck` — type-check main + renderer (verified passing).
- `bun run build` — bundle main → `out/main/index.cjs`, preload → `out/preload/index.cjs`, renderer → `out/renderer/`.
- `bun run dev` — start Vite dev server + launch Electron with HMR.
- `bun run start` (alias: `bun run preview`) — build then launch the production bundle.
- `bun run package` — `electron-vite build` + `electron-builder` (NSIS installer on Windows).

`dev` / `start` / `preview` go through `scripts/launch.cjs`, which is the only safe way to spawn Electron — see Gotchas.

## Layout

```
src/
├── shared/                 # types/contracts shared across processes
│   ├── api.ts              # DebaseApi shape (window.api typing)
│   ├── chat.ts             # ChatEvent, RunConfig, EnvironmentInfo, request/response
│   ├── ipc.ts              # IpcChannel constants
│   └── providers.ts        # Provider registry + static Claude/Codex models + runtime OpenCode/Cursor catalog types
├── main/                   # Electron main process (CJS bundle)
│   ├── index.ts            # entry, lifecycle
│   ├── window.ts           # BrowserWindow factory + custom titlebar overlay
│   ├── ipc.ts              # IPC handlers (chat, dialog, shell, window)
│   ├── agent/claude.ts     # Claude SDK integration; maps RunConfig → Options
│   ├── agent/codex.ts      # Codex CLI JSON bridge
│   ├── agent/opencode.ts   # OpenCode SDK/server bridge
│   └── agent/cursor.ts     # Cursor CLI stream-json bridge
├── preload/                # context bridge, exposes window.api (CJS bundle)
│   └── index.ts
└── renderer/               # React UI (Vite, ESM)
    ├── index.html
    └── src/
        ├── App.tsx                  # Shell + settings drawer
        ├── main.tsx
        ├── global.d.ts              # declares window.api
        ├── state/store.tsx          # useReducer + Context; project-tree state
        ├── state/types.ts           # Project, Thread, RunConfig, AppSettings
        ├── lib/persist.ts           # debase.state.v2 with v1 migration
        ├── lib/{id,format}.ts
        ├── components/
        │   ├── App-level: ChatPanel, Sidebar, TitleBar, Welcome, Settings
        │   ├── chat: ChatHeader, MessageList, Message, ToolBlock, Markdown
        │   ├── composer: Composer, RunControls
        │   ├── primitives: Popover (+MenuItem/Label/Divider), ContextMenu
        │   └── icons.tsx            # single hand-drawn-feel SVG set
        └── styles/globals.css       # Tailwind v4 + @theme tokens + font/highlight.js imports

scripts/launch.cjs          # spawns electron-vite with ELECTRON_RUN_AS_NODE removed
VERIFICATION.md             # latest-session verification log (regenerated each round)
```

## Hard rules — visual identity (anti-AI-slop)

These are **non-negotiable** for any agent (or human) editing this codebase. They exist because LLMs reach for the same handful of design defaults that make products feel templated, and this app is deliberately not that. If a rule blocks you, ask the user — don't break it.

### Don't

- **Don't add `uppercase` + `tracking-[…]` labels.** All-caps + letter-spacing reads as AI-slop dev-tool default. Use lowercase italic or sentence-case + a small font size + `text-ink-3` for hierarchy. The codebase has been audited clean — keep it that way.
- **Don't introduce dark mode.** debase is light-only, warm paper. No system-pref toggle, no sun/moon switch, no `dark:` Tailwind variants, no inverted colour palette.
- **Don't add purple/blue gradients, neon glows, or "AI sparkle" iconography for non-AI things.** The only accent is `--color-accent` (`#a3621c`, ochre). Adding a second accent breaks the contract — pick a different shade of ochre or rely on weight/size.
- **Don't use Inter, system-ui, or any other display font.** Geist Sans + JetBrains Mono only. Don't import a new font, don't fall back to Helvetica.
- **Don't introduce icon libraries** (Lucide, Feather, Phosphor, Heroicons, Radix Icons, react-icons, lucide-react, …). The hand-drawn 16×16 set in `icons.tsx` is the canon. New icons are added there at the same `strokeWidth: 1.5`, `viewBox: "0 0 16 16"`, square line-caps.
- **Don't use shadcn/Radix-look components, glassmorphism, or `backdrop-blur` panels** anywhere. We're hairlines + soft surfaces, not frosted glass.
- **Don't blink.** No `animate-pulse` / opacity-flash on live indicators. Use the `dot-cycle` utility (cycles colour, keeps opacity flat). Strobing reads as alarm.
- **Don't write AI marketing copy.** Banned strings in user-visible UI: "Elevate", "Seamless", "Unleash", "Empower", "Next-Gen", "Game-changer", "Delve", "Tapestry", "In the world of…", "Built for…", "Designed to…". Be plain and specific. No exclamation marks in success messages. No "Oops!" in errors.
- **Don't Title Case Every Header.** Sentence case for headlines and labels: "Run defaults", not "Run Defaults".
- **Don't add emojis to UI** unless the user explicitly asks. Status uses dots and lowercase words (`running`, `error`, `ok`), not 🟢🔴✅.
- **Don't centre everything.** Avoid the AI-default symmetric stack. Asymmetry is preferred — left-aligned headlines over centred bodies, offset margins, mixed widths.
- **Don't write 3 equal columns of feature cards** as a marketing pattern. If a Welcome/empty state needs three points, vary the rhythm (zig-zag, asymmetric, list with hairlines).
- **Don't use `100vh`.** Use `min-h-dvh` / `h-full` so iOS/embedded surfaces don't jump.
- **Don't reach for modals.** Inline editing, slide-over panels, expandable sections, or routed pages first. The current Settings is a *routed page*, not a dialog — keep it that way.
- **Don't pin `box-shadow: black`.** Shadows must be tinted with the surface's hue (warm) or omitted. `shadow-sm` from Tailwind already passes; `shadow-2xl` does not.
- **Don't add fake content.** No "John Doe", no "Acme Corp", no `99.99%` placeholder stats, no Lorem ipsum. If real copy isn't ready, leave the section empty or label it explicitly.
- **Don't create new `.md` planning, decision, or status documents** unless the user asks. Project docs are `CLAUDE.md`, `PROJECT.md`, `VERIFICATION.md`, and notes under `.claude/notes/`. Don't scatter `PLAN.md` / `IMPLEMENTATION.md` files.

### Do

- **Match the warm-paper palette.** Cream `#faf7ef` canvas, hairline `#e3ddcd` rules, ochre accent only. New colours go through `@theme` tokens.
- **Hairlines beat boxes.** Borders are `border-rule` (1px), not `border-2`. Use whitespace and a single rule before adding a card surface.
- **Vary the radius.** Inner controls `rounded-sm` / `rounded-md`, outer surfaces `rounded-lg` / `rounded-xl`. Don't apply one radius to everything.
- **Sentence case + italic for labels.** When you'd reach for `uppercase tracking-[…]`, write `italic text-ink-3` at 11–11.5px instead. The eyebrow / section-label pattern lives in Settings, Trace, Sidebar, Popover — copy that pattern.
- **Numbers in mono.** Anything tabular (cost, turns, tokens, paths) uses `font-mono` so digits align.
- **Live indicators cycle colour, never opacity.** `dot-cycle` (`globals.css`) is the canon. Stagger siblings with `[animation-delay:300ms]` if you need a wave.
- **Diffs use `text-add` / `text-del` tokens** (warm green / warm red), never GitHub-primary green/red.
- **Hand-drawn SVGs over icon libraries.** New icon? Add to `icons.tsx` matching the existing style (16×16, currentColor stroke, square caps, 1.5 stroke).

### Tripwires for the Tailwind class scanner

If any of these substrings show up in `git diff` for a `.tsx` change, treat it as a regression and either remove or get explicit user sign-off:

- `uppercase` (any class) — the entire codebase is audited clean.
- `animate-pulse` on dots, badges, or pills representing live state.
- `dark:` variant prefix.
- `from-purple-` / `from-blue-` / `bg-gradient-to-` (linear gradients).
- `backdrop-blur` outside the existing `Popover` / `ContextMenu` primitives.
- `font-[Inter]` / `font-[system-ui]` or any `@import` of a font that isn't Geist Sans / JetBrains Mono.
- New icon imports from `lucide-react`, `react-icons`, `@radix-ui/react-icons`, `phosphor-react`, `heroicons`.

## Conventions

- **Tailwind only.** No custom `.css` outside `globals.css` (which is the Tailwind entry: `@import "tailwindcss"`, `@theme {}`, `@utility {}`, `@layer base {}` for scrollbars/fonts).
- **Design tokens** live in `@theme`. Current palette is **warm paper editorial (light)**:
  - `--color-canvas: #faf7ef` (warm off-white background)
  - `--color-surface: #f4f0e6` (slightly warmer card surface)
  - `--color-surface-2: #ebe6d8` (raised surface)
  - `--color-rule: #e3ddcd` / `--color-rule-strong: #cdc6b3` (borders)
  - `--color-ink: #1c1a14` / `--color-ink-2 #5b574c` / `--color-ink-3 #8d877a` / `--color-ink-4 #b6b0a3` (text hierarchy)
  - `--color-accent: #a3621c` (muted ochre — the only accent), `--color-accent-deep: #7a4716`, `--color-accent-soft: #f0e1c4`
  - `--color-error: #a8331e`, `--color-error-soft: #f4dad3`
  - `--color-add: #4f7a35` / `--color-add-soft: #e2ecd5` (warm green — `DiffView` added lines)
  - `--color-del: #a8331e` / `--color-del-soft: #f4dad3` (alias of error — `DiffView` removed lines)
- **Type system**: Geist Sans for everything UI/prose; JetBrains Mono only for code blocks, the composer textarea, and provider name badges. **No all-caps tracking labels** — they read as AI-slop dev-tool default.
- **Strict TS** with `verbatimModuleSyntax: true` — type-only imports must use `import type` / `import { type X }`.
- **Shared types live in `src/shared/`** — never reach across `main` ↔ `renderer` directly; everything goes through IPC channels declared in `src/shared/ipc.ts`.
- **Window controls**: custom titlebar with `titleBarOverlay` on Windows, `hiddenInset` on macOS, and in-app minimize/maximize/close controls on Linux. Drag region is the `drag-region` Tailwind utility (defined via `@utility`).
- **Persistence**: app state stored in `localStorage` under `debase.state.v2` (`src/renderer/src/lib/persist.ts`). v1 → v2 migration runs once on first hydration: existing threads get bundled into a single "Imported" project. On every hydration, any assistant message stuck with `status: "streaming"` is repaired to `"error"` with `errorText: "Interrupted before finishing."` so the UI never shows a permanently-thinking spinner. `pending` is always wiped on reload.
- **Project tree**: `Project` (id, name, path, expanded, threads[]) is the unit of organization. The project's `path` is the provider `cwd` for every thread inside. Threads no longer carry a `provider`; each thread has a `RunConfig` (provider, model, mode, effort, thinking, context1M, optional thinkingBudget/fallbackModel).
- **Git status and diff**: `GitStatusBar.tsx` calls `project:git-status`, which runs `git -C <projectPath> status --porcelain=v1 -b` in main after the project path passes the allowlist. It renders branch/upstream/ahead/behind plus staged/unstaged/untracked/conflict counts below the chat header. The dirty-file popover and `DiffPanel.tsx` both call `project:git-diff` for read-only unified diffs, including per-file untracked files via `git diff --no-index`. `DiffPanel.tsx` supports line wrap and whitespace-insensitive mode; the latter passes `--ignore-all-space` through IPC to unstaged, staged, and no-index diff commands. `Ctrl/Cmd+D` toggles the full diff panel when the terminal is not focused; `/diff` and the command palette dispatch the same toggle. The branch/worktree popovers call `project:git-list-refs`, `project:git-switch-ref`, `project:git-create-ref`, `project:git-create-worktree`, and `project:git-remove-worktree` so a thread can switch refs, create a branch, pick a base ref, move its cwd to a dedicated worktree, or delete that worktree after confirmation.
- **Source control detection and clone**: `project:source-control-scan` checks the active authorized checkout's git remotes and local provider auth state. It is read-only: GitHub uses `gh`, GitLab uses `glab`, Azure DevOps uses `az`, and Bitbucket checks environment variables. The Settings Source control page surfaces provider availability/auth before PR/MR creation flows. `project:git-clone` runs `git clone -- <source> <target>` into a user-picked authorized destination folder, then adds the cloned checkout to the main-process project allowlist. Clone sources can be a full Git URL/local path, GitHub `owner/repo`, GitLab `group/project`, Bitbucket `workspace/repository`, or Azure DevOps `project/repository`, resolved through the matching local provider auth before cloning.
- **Diagnostics page**: Settings > Diagnostics is a live health snapshot, not a static help page. It calls `env.get`, `providers.list`, `project:list-skills`, `project:source-control-scan`, and the keybinding loader, then exposes Copy snapshot for bug reports. Keep new diagnostics wired to real IPC/state paths.
- **Archived settings page**: Settings > Archived reads archived threads from renderer state. Open selects the archived thread and returns to chat without restoring it; Restore clears `archivedAt`; Delete removes the thread after confirmation.
- **Command palette settings routes**: `App.tsx` exposes direct palette actions for Providers, Source control, Shortcuts, Archived, and Diagnostics. When adding a Settings category, add the matching palette action unless it is intentionally hidden.
- **Shortcut settings search and rules**: Settings > Shortcuts filters by shortcut id, command, description, scope, key, override key, and `when` clause before rendering groups. It also edits the raw t3code-style keybinding rule array, so arbitrary `{ key, command, when }` rows can be added or removed without opening the JSON file. Keep filtering and rule editing client-side because the keybinding data already lives in renderer state.
- **Model picker**: `RunControls.tsx` owns the provider/model/access/effort/thinking row. The model picker is controlled through `debase:toggle-model-picker` so `Ctrl/Cmd+Shift+M`, `/model`, and the command palette can open the same popover. The list is all enabled providers that are actually available; OpenCode and Cursor models come only from the runtime `ProviderCatalog`, never static fallback rows. `settings.modelPreferences` can favorite/hide models per provider and add custom Claude/Codex slugs; OpenCode/Cursor custom slugs are stripped so the local CLI catalog stays the source of truth.
- **Provider runtime settings**: `settings.providerRuntime` stores per-provider process configuration. Claude supports `binaryPath`, `homePath`, and parsed launch args; Codex supports `binaryPath`, `homePath`, and `shadowHomePath` through `CODEX_HOME`; OpenCode supports `binaryPath`, `serverUrl`, and `serverPassword` for external or local `opencode serve`; Cursor supports `binaryPath` and `apiEndpoint` passed as `-e`. Catalog refresh uses these settings, but OpenCode/Cursor remain catalog-gated by the user's installed and authenticated local CLI.
- **Composer file mentions**: `Composer.tsx` detects `@query` at the cursor and calls `project:search-files` for the active thread cwd. Main serves that from `git ls-files --cached --others --exclude-standard` when possible, otherwise a capped filesystem walk that skips vendor/build folders. Selecting a row inserts a relative `@path`; the menu also keeps the native file picker for out-of-tree files.
- **Composer skill mentions**: `Composer.tsx` detects `$query` at the cursor and calls `project:list-skills` through preload/main. Main scans real local skill roots (`~/.codex/skills`, `~/.agents/skills`, plugin cache roots, plus project `.codex/.agents/skills` when the project path is authorized), parses `SKILL.md` frontmatter, dedupes by name, and returns scoped metadata. Selecting a row inserts `$skill-name`; no fallback skill rows are synthesized.
- **Plan panel**: `PlanSidebar.tsx` renders the latest plan-mode assistant markdown for the active thread. `ChatPanel.tsx` auto-opens it when a new plan-mode response appears and listens for `debase:toggle-plan`, so `Ctrl/Cmd+Shift+L`, `/plans`, the composer `plan` toggle, and the command palette all share one surface. Saving a plan uses `project:write-file`, which only accepts relative paths under an already-authorized project/worktree cwd.
- **Terminal drawer**: `TerminalDrawer.tsx` renders `@xterm/xterm`; `src/main/terminal.ts` owns the real `node-pty` process. Terminal IPC lives under `terminal:*` channels and uses `src/shared/terminal.ts` contracts. The cwd is always the active thread cwd (`threadCwd(project, thread)`), so git worktree threads get their own shell. `Ctrl/Cmd+J` toggles the drawer; when a terminal pane is focused, `Ctrl/Cmd+D` splits, `Ctrl/Cmd+N` creates another pane, and `Ctrl/Cmd+W` closes the active pane. Global new-thread/archive/diff shortcuts explicitly ignore terminal-originated key events. The terminal toolbar can attach the active xterm selection, or the last terminal output when nothing is selected, as composer terminal context. `src/renderer/src/lib/terminalContext.ts` materializes those chips into a trailing `<terminal_context>` prompt block and `Message.tsx` hides that block behind compact chips in the timeline. Tasks moved to `Ctrl/Cmd+Shift+J`.
- **Keybindings**: `src/renderer/src/lib/shortcuts.ts` owns command IDs and default rules. `src/renderer/src/state/keybindings.tsx` merges defaults with Electron user-data `keybindings.json`. The preferred on-disk format is the t3code-style rule array `{ key, command, when }`; `when` supports `terminalFocus`, `terminalOpen`, `modelPickerOpen`, `!`, `&&`, `||`, and parentheses. `editor.openFavorite` maps to the existing configured editor command and defaults to `Ctrl/Cmd+O`. Legacy object overrides are still read, but new saves write the rule array.
- **Run modes** (`RunConfig.mode`) map to SDK `permissionMode`:
  - `build` → `default`. `auto-edit` → `acceptEdits`. `plan` → `plan`. `full-access` → `bypassPermissions` + `allowDangerouslySkipPermissions: true`.
- **Thinking** (`RunConfig.thinking`) maps to SDK `ThinkingConfig`:
  - `adaptive` → `{ type: "adaptive" }`. `enabled` → `{ type: "enabled", budgetTokens }`. `disabled` → `{ type: "disabled" }`.
- **1M context**: only Sonnet 4.x supports the `context-1m-2025-08-07` beta header; for Opus 4.7 the 1M variant is its own model id `claude-opus-4-7[1m]` (see `MODELS` in `src/shared/providers.ts`). The 1M toggle in the run controls only renders when `modelSupports1MBeta(model)`.
- **No custom system prompt.** `runClaude` never sets `customSystemPrompt` or `appendSystemPrompt`. The CLI / SDK applies its own. This was an explicit user requirement: "the app is just a UI shell — keep Claude Code's behavior intact."
- **Effort labels are literal SDK tokens.** UI shows `low / medium / high / xhigh / max` exactly as in `sdk.d.ts` line ~1104 — not localized strings like "Very high". This is a hard rule from the user.
- **Logo is vendored, not redrawn.** `ClaudeMark` in `src/renderer/src/components/icons.tsx` is the verbatim path from `node_modules/@anthropic-ai/sdk/.github/logo.svg` (viewBox `0 0 248 248`, fill `#D97757`). Do not modify the path data.
- **`MODELS` registry mirrors the SDK's `ModelInfo` shape.** Field names (`value`, `displayName`, `description`, `supportedEffortLevels`, `supportsAdaptiveThinking`) match `sdk.d.ts` line ~1080 so we can drop in dynamic data from `Query.supportedModels()` later without renaming.
- **Ultrathink visual.** Typing `ultrathink` in the composer triggers a rotating conic-gradient halo (`@utility ultrathink-frame`) and hue-cycling Claude mark (`@utility ultrathink-hue`). Defined in `globals.css` alongside `@property --ultra-angle` (Houdini animatable angle) and the `ultra-spin` / `ultra-hue` / `ultra-glow` keyframes. The CLI already treats the literal phrase as a request for max thinking budget; the UI is just a cue.
- **Live indicators don't blink.** Don't use `animate-pulse` on running/working dots — opacity-blink reads as alarm. The `dot-cycle` utility in `globals.css` glides the dot's background through four warm tones (no opacity change) and is what `WorkingIndicator` (Message.tsx) and the running tool dot in `Trace.tsx` use. Stagger siblings with `[animation-delay:300ms]`-style classes.
- **Settings is a routed page, not a modal.** `App.tsx` swaps between `<ChatPanel/>` and `<Settings/>` in the right pane based on `view: "chat" | "settings"`. `Ctrl/Cmd+,` toggles, `Esc` returns to chat. The category rail (General · Providers · Source control · Shortcuts · Diagnostics · Environment · About) lives inside `Settings.tsx`. Don't reintroduce a fixed-position drawer.
- **Edit/Write/MultiEdit show inline diffs.** `DiffView.tsx` exports `tryRenderDiff(name, input)` — `Trace.tsx`'s expanded panel calls it; if it returns a node, the input JSON block is replaced by the diff. Edit produces a remove-then-insert hunk (no surrounding context — Edit doesn't carry it); Write renders the whole content as adds; MultiEdit concatenates each hunk with a blank context separator.
- **Assistant turns are copyable.** `Message.tsx`'s `CopyAction` (top-right, hover-revealed) joins all `text` blocks (no thinking, no tool input/output) and writes to `navigator.clipboard`. Confirms with a 1.4s "copied" chip swap.
- **Threads can be archived, not just deleted.** `Thread.archivedAt: number | null` is the archive flag. `setThreadArchived(id, archived)` cancels any in-flight stream first. Sidebar `ThreadRow` hides hover icons when `running`, and shows a single Archive button (not Trash) otherwise — the right-click context menu still has Pin/Restore/Delete. The collapsible `ArchiveSection` lives between the project list and the Settings button; archived threads are excluded from `filterThreads` so they never appear in their original project.

## Gotchas

- **`ELECTRON_RUN_AS_NODE` must NOT be set** when launching the app. If it is set (some toolchains export it to use Electron's binary as a Node runtime), Electron starts in pure-Node mode, `process.type` is `undefined`, and `require("electron")` returns a path string instead of the API. `scripts/launch.cjs` deletes it before spawning `electron-vite`. Don't bypass that script.
- **Bun + Electron postinstall**: `bun install` may not run `electron`'s `install.js` automatically. If `node_modules/electron/dist/` is missing, run `node node_modules/electron/install.js` once.
- **Main / preload are CJS, SDK is ESM.** `@anthropic-ai/claude-agent-sdk` ships only as `.mjs`. In `src/main/agent/claude.ts` it is loaded via `await import(...)` and cached in a promise; do not switch back to a static `import { query } from "..."` — the bundle would compile to `require()` and crash at startup with `ERR_REQUIRE_ESM`.
- **Vite 8 incompatible.** `@vitejs/plugin-react@4` and `electron-vite@5` peer-require Vite ≤ 7. Pinned at `^7.0.0` in `package.json`.
- **electron-vite preload outputs `.cjs`** (configured explicitly via `rollupOptions.output.format: "cjs"` + `entryFileNames: "[name].cjs"`). The main `BrowserWindow` preload path is `../preload/index.cjs`. Do not change without updating both ends.

## Decisions

- 2026-05-10 - **Terminal is real PTY, not fake stdout.** The drawer uses `node-pty` in main and xterm in renderer. It opens in the selected thread cwd/worktree, streams output through IPC, and keeps shell/auth behavior local to the user's machine.
- 2026-05-10 - **Diff panel reads git, not agent traces.** The right-side panel uses `project:git-status` and `project:git-diff` against the active thread cwd/worktree. It is a source-control view for the working tree, separate from the inline `DiffView` used for Edit/Write/MultiEdit tool inputs.
- 2026-05-10 - **Diff review has whitespace mode.** The panel can toggle `--ignore-all-space` through `project:git-diff`, matching t3code's expectation that formatting-only churn can be hidden during review.
- 2026-05-10 - **Model picker is global but catalog-gated.** The shortcut and command palette dispatch an event into the active composer. The picker searches enabled available providers only, preserving the OpenCode/Cursor rule that local CLI auth/catalog detection is the source of truth.
- 2026-05-10 - **Model preferences are provider-scoped.** Favorites and hidden models affect the picker ordering/visibility per provider. Claude/Codex can carry user-added model slugs through persistence and send validation, but OpenCode and Cursor remain catalog-only from the local CLI.
- 2026-05-10 - **Provider runtime config follows local CLI ownership.** Settings can override binary paths, homes, OpenCode server credentials, and Cursor ACP endpoint, but the provider remains the user's installed/logged-in CLI. debase does not synthesize OpenCode/Cursor model rows outside the runtime catalog.
- 2026-05-10 - **Plan review is a first-class panel.** Plan mode still stores output as normal assistant messages, but the renderer derives the latest plan into a right-side panel rather than requiring a separate server projection. Save-to-workspace is main-process IPC guarded by the existing project-root allowlist and relative-path validation.
- 2026-05-10 - **Keybindings are command rules, not shortcut IDs.** debase now reads and writes t3code-style `{ key, command, when }` arrays so one key can do different work inside terminal focus (`Ctrl/Cmd+N` creates a terminal pane) and normal chat focus (`Ctrl/Cmd+N` creates a thread).
- 2026-05-10 - **Composer mentions are cwd-backed.** The app no longer treats `@` as only a file-dialog trigger; it searches the active cwd through main-process IPC and inserts project-relative paths.
- 2026-05-10 - **Skill mentions are local-skill-backed.** The `$` composer picker reads installed `SKILL.md` files from the user's Codex/Agents/project roots through main-process IPC and inserts the literal `$skill` token used by the underlying agents.
- 2026-05-10 - **Terminal context is explicit composer state.** The terminal attach action snapshots selected xterm text, or recent output, into per-thread composer chips. Sending appends a structured `<terminal_context>` block to the prompt, while rendered user messages show only compact terminal chips.
- 2026-05-10 - **Source control setup is visible.** Settings can scan remotes and local auth for GitHub/GitLab/Bitbucket/Azure DevOps before publish or review flows mutate git state.
- 2026-05-10 - **Provider-aware clone is a project entry point.** The command palette and Welcome screen open a clone dialog that supports full Git URLs/local paths plus GitHub/GitLab/Bitbucket/Azure DevOps repository paths resolved through the user's local provider auth before running local `git clone`.
- 2026-05-10 - **Diagnostics are live IPC checks.** Settings > Diagnostics reports environment, provider catalog, local skills, keybindings, source-control status, active cwd, and app counters from runtime state, then copies the same data as JSON.
- 2026-05-10 - **Archived threads have a Settings surface.** The sidebar archive remains quick access, while Settings > Archived is the management view for opening, restoring, or deleting archived threads.
- 2026-05-10 - **Settings pages are palette-addressable.** The command palette opens core Settings sections directly so new diagnostics/archive surfaces are searchable without manual sidebar navigation.
- 2026-05-10 - **Shortcut settings manage raw rules.** The Shortcuts page can filter bindings before remap and can add/remove raw `{ key, command, when }` rows, matching the t3code expectation that keybindings are a managed rule table rather than a static reference.

- 2026-05-10 — **Provider scope: Claude, Codex, OpenCode, Cursor.** Claude uses the Agent SDK, Codex uses `codex exec --json`, OpenCode uses `@opencode-ai/sdk` with a local `opencode serve` process, and Cursor uses the official `agent -p --output-format stream-json --stream-partial-output` CLI path. OpenCode and Cursor are gated by runtime catalog detection: no local CLI/auth means no provider/models in the picker.
- 2026-05-08 — **SDK over CLI subprocess for Claude.** Reuses the user's `claude` CLI login automatically, no API key required. Confirmed working with `process.versions.electron === 33.4.11`.
- 2026-05-08 — **Aesthetic locked: "warm paper editorial" (light).** Cream paper canvas (`#faf7ef`), hairline rules, single ochre accent (`#a3621c`), Geist Sans for prose, JetBrains Mono only for code/composer/badges. **No all-caps tracking labels, no glassmorphism, no gradients, no AI-default purple.**
- 2026-05-08 — **Persistence in localStorage** for v1/v2. Will move to a small SQLite (better-sqlite3 in main) when project/thread count starts hurting performance.
- 2026-05-08 — **Thin shell, no custom system prompt.** Per user requirement: "the app is just a UI for Claude Code — whatever the original CLI has, ours has; nothing custom layered on top." Modes/effort/thinking/context options expose what the SDK already provides; the agent's own system prompt is left untouched.
- 2026-05-08 — **Project = cwd anchor, threads nest beneath it.** A user can open multiple projects; each project's path is the working directory for every thread inside it. New thread is a pencil icon revealed on hover over the project row, plus Ctrl/Cmd+N. Codex/OpenCode tabs were removed from the sidebar; they live in Settings now.

## Bug Log

- 2026-05-10 - Full access still showed permission prompts.
  - Root cause: `src/main/ipc.ts` had a second native "Allow full access?" confirmation path, and the renderer still sent `askBeforeTools: true` even when the thread run config had `fullAccess: true`.
  - Fix: treat `fullAccess` as authoritative. Main no longer shows a second confirmation dialog, and both renderer/main suppress the per-tool permission bridge when full access is enabled.
- 2026-05-10 — OpenCode turns completed with `1 turn ...` metadata but no assistant text.
  - Root cause: `src/main/agent/opencode.ts` waited on the wrong event stream path, so local OpenCode could finish without any mapped text events and only emit a result.
  - Fix: use `session.promptAsync`, subscribe to `client.global.event()`, poll `session.status` until idle, and map `session.next.*` / message-part events into live renderer chunks.
- 2026-05-10 — OpenCode showed only "working" while the model ran, then dumped the whole answer at the end.
  - Root cause: local `opencode serve` sends the useful live events (`message.part.delta`, `session.status`, tool events) through `client.global.event()`. `client.event.subscribe()` only produced `server.connected` in the local app path, so the renderer had nothing to append during the run.
  - Fix: subscribe to `client.global.event()`, unwrap `globalEvent.payload`, route that payload through the existing OpenCode dispatcher, and coalesce adjacent renderer text/thinking chunks so tiny provider deltas render as one growing block instead of dozens of rows.
- 2026-05-08 — App refused to start; `electron.app.whenReady` was undefined.
  - Root cause: `ELECTRON_RUN_AS_NODE=1` was exported in the user's machine env. Electron's binary detected it and ran the entry as plain Node, bypassing main process initialization.
  - Fix: `scripts/launch.cjs` clones `process.env`, deletes `ELECTRON_RUN_AS_NODE`, and spawns `electron-vite` with the cleaned env. All `dev`/`start`/`preview` scripts go through it.
- 2026-05-08 — `Error [ERR_REQUIRE_ESM]` on first launch attempt for `@anthropic-ai/claude-agent-sdk`.
  - Root cause: SDK is ESM-only (`.mjs`); main bundle is CJS; static import compiled to `require()` which fails on ESM in Node 20 (Electron 33's bundled Node).
  - Fix: replaced the static import in `src/main/agent/claude.ts` with cached `await import(...)`.

## Verified This Session

See `VERIFICATION.md` for the latest log. Reproduce with:

```pwsh
bun run typecheck      # exit 0
bun run build          # exit 0
Start-Process -FilePath 'bun' -ArgumentList 'run','start' -PassThru `
  -RedirectStandardOutput 'app-stdout.log' -RedirectStandardError 'app-stderr.log'
# Wait ~6s, then:
Get-Process -Name electron | Select-Object Id,MainWindowHandle,MainWindowTitle
#   exactly one row should have MainWindowHandle ≠ 0 and Title 'debase'.
Get-Content app-stderr.log    # empty besides the bun launcher line
```

End-to-end prompt round-trip with Claude (real SDK call) is **not** automated — it
would burn a paid agent turn. Manual reproduction: launch, click "Choose a folder",
point at any repo, click "New thread", type a prompt → assistant should stream a
reply, the title should auto-shrink from the prompt, and "Stop" should mark the
message "Cancelled."

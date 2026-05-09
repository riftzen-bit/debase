# debase

## Purpose

Desktop GUI shell that wraps multiple AI coding CLIs (Claude Code, Codex, OpenCode) into one interface. Inspired by t3.codes / pingdotgg/t3code in scope, but a self-contained Electron app rather than a hosted web UI.

Currently shipping with the **Claude** provider only. `codex` and `opencode` are listed in the provider switcher but disabled (planned).

## Stack

- Runtime / shell: **Electron 33** (downgraded from 42 — see Gotchas)
- Build: **electron-vite 5** (Vite 7 under the hood)
- UI: **React 19 + TypeScript 5 + Tailwind CSS 4**
- Markdown: `react-markdown` + `remark-gfm` + `rehype-highlight` (highlight.js theme: github-dark-dimmed)
- Fonts: `@fontsource/geist-sans` (display + body), `@fontsource/jetbrains-mono` (composer + code)
- Agent: `@anthropic-ai/claude-agent-sdk` (loaded via dynamic import — SDK is ESM, main bundle is CJS)
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
│   └── providers.ts        # Provider registry + Model registry (MODELS, ModelInfo)
├── main/                   # Electron main process (CJS bundle)
│   ├── index.ts            # entry, lifecycle
│   ├── window.ts           # BrowserWindow factory + custom titlebar overlay
│   ├── ipc.ts              # IPC handlers (chat, dialog, shell, window)
│   └── agent/claude.ts     # Claude SDK integration; maps RunConfig → Options
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
- **Window controls**: custom titlebar with `titleBarOverlay` on Windows / `hiddenInset` on macOS. Drag region is the `drag-region` Tailwind utility (defined via `@utility`).
- **Persistence**: app state stored in `localStorage` under `debase.state.v2` (`src/renderer/src/lib/persist.ts`). v1 → v2 migration runs once on first hydration: existing threads get bundled into a single "Imported" project. On every hydration, any assistant message stuck with `status: "streaming"` is repaired to `"error"` with `errorText: "Interrupted before finishing."` so the UI never shows a permanently-thinking spinner. `pending` is always wiped on reload.
- **Project tree**: `Project` (id, name, path, expanded, threads[]) is the unit of organization. The project's `path` is the SDK `cwd` for every thread inside. Threads no longer carry a `provider` — Claude is the only ready provider; Codex/OpenCode are toggled in `Settings`. Each thread has a `RunConfig` (model, mode, effort, thinking, context1M, optional thinkingBudget/fallbackModel).
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
- **Settings is a routed page, not a modal.** `App.tsx` swaps between `<ChatPanel/>` and `<Settings/>` in the right pane based on `view: "chat" | "settings"`. `Ctrl/Cmd+,` toggles, `Esc` returns to chat. The category rail (General · Providers · Environment · About) lives inside `Settings.tsx`. Don't reintroduce a fixed-position drawer.
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

- 2026-05-08 — **MVP scope: Claude only.** Codex / OpenCode appear in `Settings` as toggles (off by default) so the UX intent is visible; they will be added by spawning each CLI as a child process and parsing stdout (no SDK exists for them).
- 2026-05-08 — **SDK over CLI subprocess for Claude.** Reuses the user's `claude` CLI login automatically, no API key required. Confirmed working with `process.versions.electron === 33.4.11`.
- 2026-05-08 — **Aesthetic locked: "warm paper editorial" (light).** Cream paper canvas (`#faf7ef`), hairline rules, single ochre accent (`#a3621c`), Geist Sans for prose, JetBrains Mono only for code/composer/badges. **No all-caps tracking labels, no glassmorphism, no gradients, no AI-default purple.**
- 2026-05-08 — **Persistence in localStorage** for v1/v2. Will move to a small SQLite (better-sqlite3 in main) when project/thread count starts hurting performance.
- 2026-05-08 — **Thin shell, no custom system prompt.** Per user requirement: "the app is just a UI for Claude Code — whatever the original CLI has, ours has; nothing custom layered on top." Modes/effort/thinking/context options expose what the SDK already provides; the agent's own system prompt is left untouched.
- 2026-05-08 — **Project = cwd anchor, threads nest beneath it.** A user can open multiple projects; each project's path is the working directory for every thread inside it. New thread is a pencil icon revealed on hover over the project row, plus Ctrl/Cmd+Shift+N. Codex/OpenCode tabs were removed from the sidebar; they live in Settings now.

## Bug Log

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

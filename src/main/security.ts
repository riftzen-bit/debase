import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { platform } from "node:os";

// Persisted set of absolute paths the user has explicitly authorized as
// project roots. Anything outside this set is denied for cwd-bound IPC
// (ChatSend, ShellOpenPath, OpenInEditor). Source of truth is on disk —
// localStorage is renderer-controlled and therefore untrusted.
const FILE_NAME = "project-roots.json";
const isWindows = platform() === "win32";

let cached: Set<string> | null = null;
let bootstrapAccepted = false;

function rootsFilePath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

function normalize(p: string): string {
  // path.resolve folds `..` segments and drops trailing separators, so
  // attempts like `C:\Projects\debase\..\..\Windows` collapse to
  // `C:\Windows` before the prefix check runs.
  const resolved = resolve(p);
  return isWindows ? resolved.toLowerCase() : resolved;
}

async function loadFromDisk(): Promise<Set<string>> {
  try {
    const raw = await readFile(rootsFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const p of parsed) {
      if (typeof p === "string" && p.length > 0) out.add(normalize(p));
    }
    return out;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return new Set();
    // Corrupted JSON — start empty rather than crash. The user can re-pick
    // projects via the dialog and the file is rebuilt on first add.
    return new Set();
  }
}

async function flush(): Promise<void> {
  if (!cached) return;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(
    rootsFilePath(),
    JSON.stringify([...cached], null, 2) + "\n",
    "utf8",
  );
}

async function ensureLoaded(): Promise<Set<string>> {
  if (!cached) cached = await loadFromDisk();
  return cached;
}

export async function addProjectRoot(p: string): Promise<void> {
  if (!p || typeof p !== "string") return;
  const set = await ensureLoaded();
  set.add(normalize(p));
  await flush();
}

export async function isInsideAllowedRoot(p: string): Promise<boolean> {
  if (!p || typeof p !== "string") return false;
  const set = await ensureLoaded();
  if (set.size === 0) return false;
  const norm = normalize(p);
  for (const root of set) {
    if (norm === root) return true;
    // Accept either separator — Windows `path.resolve` returns backslashes,
    // but a renderer compromise might smuggle forward-slash variants in.
    if (norm.startsWith(root + sep)) return true;
    if (norm.startsWith(root + "/")) return true;
  }
  return false;
}

/**
 * One-shot import of paths the renderer already has persisted (typically
 * from an older build that didn't track this server-side). Idempotent
 * within a launch — subsequent calls are ignored so a compromised renderer
 * later in the session can't widen the allowlist without going through the
 * native chooseDirectory dialog.
 */
export async function bootstrapAllowlist(paths: string[]): Promise<void> {
  if (bootstrapAccepted) return;
  bootstrapAccepted = true;
  if (!Array.isArray(paths)) return;
  const set = await ensureLoaded();
  const added: string[] = [];
  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0) continue;
    const norm = normalize(p);
    if (!set.has(norm)) {
      set.add(norm);
      added.push(norm);
    }
  }
  if (added.length > 0) {
    // Audit trail: a single line per launch is enough to catch a poisoned
    // localStorage entry post-mortem. No PII beyond the project paths the
    // user already authorised in a prior session.
    console.info("[debase:security] bootstrapped project roots:", added);
    await flush();
  }
}

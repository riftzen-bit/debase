import type { WebContents } from "electron";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import * as nodePty from "node-pty";
import { IpcChannel } from "@shared/ipc";
import {
  DEFAULT_TERMINAL_ID,
  type TerminalCloseRequest,
  type TerminalEvent,
  type TerminalOpenRequest,
  type TerminalResizeRequest,
  type TerminalResponse,
  type TerminalSessionRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionStatus,
  type TerminalWriteRequest,
} from "@shared/terminal";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MAX_COLS = 1000;
const MAX_ROWS = 500;
const MAX_WRITE_BYTES = 65_536;
const MAX_HISTORY_BYTES = 400_000;
const ENV_BLOCKLIST = new Set(["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_PORT", "PORT"]);

type TerminalSession = {
  threadId: string;
  terminalId: string;
  cwd: string;
  worktreePath: string | null;
  status: TerminalSessionStatus;
  pid: number | null;
  history: string;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
  cols: number;
  rows: number;
  process: nodePty.IPty | null;
};

type ShellCandidate = {
  shell: string;
  args: string[];
};

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly getWebContents: () => WebContents | null,
    private readonly isAllowedCwd: (cwd: string) => Promise<boolean>,
  ) {}

  async open(raw: TerminalOpenRequest): Promise<TerminalResponse> {
    try {
      const input = await this.validateOpen(raw);
      const key = sessionKey(input.threadId, input.terminalId);
      const existing = this.sessions.get(key);
      if (existing) {
        if (existing.cwd !== input.cwd || existing.status === "exited" || existing.status === "error") {
          this.stopProcess(existing);
          existing.cwd = input.cwd;
          existing.worktreePath = input.worktreePath;
          existing.history = "";
          existing.exitCode = null;
          existing.exitSignal = null;
          existing.cols = input.cols;
          existing.rows = input.rows;
          this.start(existing, input.env, "started");
        } else {
          this.resizeSession(existing, input.cols, input.rows);
        }
        return { ok: true, snapshot: snapshot(existing) };
      }

      const session: TerminalSession = {
        threadId: input.threadId,
        terminalId: input.terminalId,
        cwd: input.cwd,
        worktreePath: input.worktreePath,
        status: "starting",
        pid: null,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: nowIso(),
        cols: input.cols,
        rows: input.rows,
        process: null,
      };
      this.sessions.set(key, session);
      this.start(session, input.env, "started");
      return { ok: true, snapshot: snapshot(session) };
    } catch (err) {
      return failure(err);
    }
  }

  async write(raw: TerminalWriteRequest): Promise<TerminalResponse> {
    try {
      const threadId = trimmed(raw?.threadId, "threadId");
      const terminalId = terminalIdOrDefault(raw?.terminalId);
      const data = typeof raw?.data === "string" ? raw.data : "";
      if (data.length === 0) throw new Error("Terminal data is required");
      if (Buffer.byteLength(data, "utf8") > MAX_WRITE_BYTES) {
        throw new Error("Terminal write payload is too large");
      }
      const session = this.requireSession(threadId, terminalId);
      if (!session.process || session.status !== "running") {
        throw new Error("Terminal is not running");
      }
      session.process.write(data);
      return { ok: true, snapshot: snapshot(session) };
    } catch (err) {
      return failure(err);
    }
  }

  async resize(raw: TerminalResizeRequest): Promise<TerminalResponse> {
    try {
      const threadId = trimmed(raw?.threadId, "threadId");
      const terminalId = terminalIdOrDefault(raw?.terminalId);
      const cols = boundedInt(raw?.cols, "cols", MAX_COLS);
      const rows = boundedInt(raw?.rows, "rows", MAX_ROWS);
      const session = this.requireSession(threadId, terminalId);
      this.resizeSession(session, cols, rows);
      return { ok: true, snapshot: snapshot(session) };
    } catch (err) {
      return failure(err);
    }
  }

  async clear(raw: TerminalSessionRequest): Promise<TerminalResponse> {
    try {
      const session = this.requireSession(
        trimmed(raw?.threadId, "threadId"),
        terminalIdOrDefault(raw?.terminalId),
      );
      session.history = "";
      session.updatedAt = nowIso();
      this.emit({
        type: "cleared",
        threadId: session.threadId,
        terminalId: session.terminalId,
        createdAt: session.updatedAt,
      });
      return { ok: true, snapshot: snapshot(session) };
    } catch (err) {
      return failure(err);
    }
  }

  async restart(raw: TerminalOpenRequest): Promise<TerminalResponse> {
    try {
      const input = await this.validateOpen(raw);
      const key = sessionKey(input.threadId, input.terminalId);
      const existing = this.sessions.get(key);
      if (existing) {
        this.stopProcess(existing);
        existing.cwd = input.cwd;
        existing.worktreePath = input.worktreePath;
        existing.history = "";
        existing.exitCode = null;
        existing.exitSignal = null;
        existing.cols = input.cols;
        existing.rows = input.rows;
        this.start(existing, input.env, "restarted");
        return { ok: true, snapshot: snapshot(existing) };
      }
      return this.open(input);
    } catch (err) {
      return failure(err);
    }
  }

  async close(raw: TerminalCloseRequest): Promise<TerminalResponse> {
    try {
      const threadId = trimmed(raw?.threadId, "threadId");
      const terminalId = raw?.terminalId ? trimmed(raw.terminalId, "terminalId") : null;
      if (terminalId) {
        this.closeSession(threadId, terminalId, raw.deleteHistory === true);
      } else {
        for (const session of [...this.sessions.values()]) {
          if (session.threadId === threadId) {
            this.closeSession(session.threadId, session.terminalId, raw.deleteHistory === true);
          }
        }
      }
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      this.stopProcess(session);
    }
    this.sessions.clear();
  }

  private async validateOpen(raw: TerminalOpenRequest): Promise<{
    threadId: string;
    terminalId: string;
    cwd: string;
    worktreePath: string | null;
    cols: number;
    rows: number;
    env?: Record<string, string>;
  }> {
    const threadId = trimmed(raw?.threadId, "threadId");
    const terminalId = terminalIdOrDefault(raw?.terminalId);
    const cwd = trimmed(raw?.cwd, "cwd");
    if (!(await this.isAllowedCwd(cwd))) {
      throw new Error("Terminal cwd is not inside an authorized project root");
    }
    const info = await stat(cwd).catch((err: unknown) => {
      throw new Error(`Terminal cwd is not accessible: ${messageOf(err)}`);
    });
    if (!info.isDirectory()) throw new Error(`Terminal cwd is not a directory: ${cwd}`);

    const cols = boundedInt(raw?.cols ?? DEFAULT_COLS, "cols", MAX_COLS);
    const rows = boundedInt(raw?.rows ?? DEFAULT_ROWS, "rows", MAX_ROWS);
    const worktreePath =
      typeof raw?.worktreePath === "string" && raw.worktreePath.trim()
        ? raw.worktreePath.trim()
        : null;
    const env = normalizeEnv(raw?.env);
    return { threadId, terminalId, cwd, worktreePath, cols, rows, ...(env ? { env } : {}) };
  }

  private start(
    session: TerminalSession,
    runtimeEnv: Record<string, string> | undefined,
    eventType: "started" | "restarted",
  ): void {
    session.status = "starting";
    session.pid = null;
    session.updatedAt = nowIso();

    const env = createTerminalEnv(process.env, runtimeEnv);
    const candidates = resolveShellCandidates(process.platform, process.env);
    const failures: string[] = [];

    for (const candidate of candidates) {
      try {
        const ptyProcess = nodePty.spawn(candidate.shell, candidate.args, {
          cwd: session.cwd,
          cols: session.cols,
          rows: session.rows,
          env,
          name: platform() === "win32" ? "xterm-color" : "xterm-256color",
        });
        session.process = ptyProcess;
        session.pid = ptyProcess.pid;
        session.status = "running";
        session.exitCode = null;
        session.exitSignal = null;
        session.updatedAt = nowIso();

        ptyProcess.onData((data) => {
          if (session.process !== ptyProcess) return;
          session.history = capHistory(session.history + data);
          session.updatedAt = nowIso();
          this.emit({
            type: "output",
            threadId: session.threadId,
            terminalId: session.terminalId,
            createdAt: session.updatedAt,
            data,
          });
        });
        ptyProcess.onExit((event) => {
          if (session.process !== ptyProcess) return;
          session.status = "exited";
          session.process = null;
          session.pid = null;
          session.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
          session.exitSignal =
            typeof event.signal === "number" && Number.isInteger(event.signal)
              ? event.signal
              : null;
          session.updatedAt = nowIso();
          this.emit({
            type: "exited",
            threadId: session.threadId,
            terminalId: session.terminalId,
            createdAt: session.updatedAt,
            exitCode: session.exitCode,
            exitSignal: session.exitSignal,
          });
        });

        this.emit({
          type: eventType,
          threadId: session.threadId,
          terminalId: session.terminalId,
          createdAt: session.updatedAt,
          snapshot: snapshot(session),
        });
        return;
      } catch (err) {
        failures.push(`${formatShell(candidate)}: ${messageOf(err)}`);
      }
    }

    session.status = "error";
    session.process = null;
    session.pid = null;
    session.updatedAt = nowIso();
    this.emit({
      type: "error",
      threadId: session.threadId,
      terminalId: session.terminalId,
      createdAt: session.updatedAt,
      message: `Failed to start terminal. ${failures.join(" | ")}`,
    });
  }

  private requireSession(threadId: string, terminalId: string): TerminalSession {
    const session = this.sessions.get(sessionKey(threadId, terminalId));
    if (!session) throw new Error("Unknown terminal session");
    return session;
  }

  private resizeSession(session: TerminalSession, cols: number, rows: number): void {
    session.cols = cols;
    session.rows = rows;
    session.updatedAt = nowIso();
    if (session.process && session.status === "running") {
      session.process.resize(cols, rows);
    }
  }

  private closeSession(threadId: string, terminalId: string, deleteHistory: boolean): void {
    const key = sessionKey(threadId, terminalId);
    const session = this.sessions.get(key);
    if (!session) return;
    this.stopProcess(session);
    if (!deleteHistory) {
      session.process = null;
      session.pid = null;
    }
    this.sessions.delete(key);
  }

  private stopProcess(session: TerminalSession): void {
    const ptyProcess = session.process;
    if (!ptyProcess) return;
    session.process = null;
    try {
      ptyProcess.kill();
    } catch {
      // The PTY may already have exited between event delivery and cleanup.
    }
  }

  private emit(event: TerminalEvent): void {
    const wc = this.getWebContents();
    if (!wc || wc.isDestroyed()) return;
    wc.send(IpcChannel.TerminalEvent, event);
  }
}

function snapshot(session: TerminalSession): TerminalSessionSnapshot {
  return {
    threadId: session.threadId,
    terminalId: session.terminalId,
    cwd: session.cwd,
    worktreePath: session.worktreePath,
    status: session.status,
    pid: session.pid,
    history: session.history,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    updatedAt: session.updatedAt,
  };
}

function sessionKey(threadId: string, terminalId: string): string {
  return `${threadId}\0${terminalId}`;
}

function trimmed(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Missing ${name}`);
  const text = value.trim();
  if (!text) throw new Error(`Missing ${name}`);
  return text;
}

function terminalIdOrDefault(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TERMINAL_ID;
}

function boundedInt(value: unknown, name: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid terminal ${name}`);
  }
  if (value < 1 || value > max) throw new Error(`Terminal ${name} is out of range`);
  return value;
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal env");
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 128) {
      throw new Error(`Invalid terminal env key: ${key}`);
    }
    if (typeof raw !== "string" || raw.length > 8_192) {
      throw new Error(`Invalid terminal env value for ${key}`);
    }
    if (!ENV_BLOCKLIST.has(key)) out[key] = raw;
  }
  return out;
}

function createTerminalEnv(
  base: NodeJS.ProcessEnv,
  runtime: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !ENV_BLOCKLIST.has(key)) env[key] = value;
  }
  env.TERM_PROGRAM = "debase";
  env.COLORTERM = env.COLORTERM ?? "truecolor";
  if (runtime) {
    for (const [key, value] of Object.entries(runtime)) env[key] = value;
  }
  return env;
}

function resolveShellCandidates(
  currentPlatform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ShellCandidate[] {
  if (currentPlatform === "win32") {
    const root = env.SystemRoot?.trim() || env.windir?.trim() || "C:\\Windows";
    return uniqueShells([
      shell("pwsh.exe", ["-NoLogo"]),
      shell(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo"]),
      shell("powershell.exe", ["-NoLogo"]),
      env.ComSpec ? shell(env.ComSpec, []) : null,
      shell(join(root, "System32", "cmd.exe"), []),
      shell("cmd.exe", []),
    ]);
  }
  return uniqueShells([
    env.SHELL ? shell(env.SHELL, []) : null,
    shell("/bin/zsh", []),
    shell("/bin/bash", []),
    shell("/bin/sh", []),
    shell("zsh", []),
    shell("bash", []),
    shell("sh", []),
  ]);
}

function shell(shellPath: string, args: string[]): ShellCandidate {
  return { shell: shellPath, args };
}

function uniqueShells(candidates: Array<ShellCandidate | null>): ShellCandidate[] {
  const seen = new Set<string>();
  const out: ShellCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = formatShell(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function formatShell(candidate: ShellCandidate): string {
  return candidate.args.length > 0 ? `${candidate.shell} ${candidate.args.join(" ")}` : candidate.shell;
}

function capHistory(history: string): string {
  if (Buffer.byteLength(history, "utf8") <= MAX_HISTORY_BYTES) return history;
  return history.slice(Math.max(0, history.length - MAX_HISTORY_BYTES));
}

function nowIso(): string {
  return new Date().toISOString();
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failure(err: unknown): TerminalResponse {
  return { ok: false, error: messageOf(err) };
}

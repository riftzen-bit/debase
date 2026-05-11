export const DEFAULT_TERMINAL_ID = "default";

export type TerminalSessionStatus = "starting" | "running" | "exited" | "error";

export type TerminalSessionSnapshot = {
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
};

export type TerminalOpenRequest = {
  threadId: string;
  terminalId?: string;
  cwd: string;
  worktreePath?: string | null;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
};

export type TerminalWriteRequest = {
  threadId: string;
  terminalId?: string;
  data: string;
};

export type TerminalResizeRequest = {
  threadId: string;
  terminalId?: string;
  cols: number;
  rows: number;
};

export type TerminalSessionRequest = {
  threadId: string;
  terminalId?: string;
};

export type TerminalRestartRequest = TerminalOpenRequest;

export type TerminalCloseRequest = {
  threadId: string;
  terminalId?: string;
  deleteHistory?: boolean;
};

export type TerminalResponse =
  | { ok: true; snapshot?: TerminalSessionSnapshot }
  | { ok: false; error: string };

export type TerminalEvent =
  | {
      type: "started";
      threadId: string;
      terminalId: string;
      createdAt: string;
      snapshot: TerminalSessionSnapshot;
    }
  | {
      type: "output";
      threadId: string;
      terminalId: string;
      createdAt: string;
      data: string;
    }
  | {
      type: "exited";
      threadId: string;
      terminalId: string;
      createdAt: string;
      exitCode: number | null;
      exitSignal: number | null;
    }
  | {
      type: "error";
      threadId: string;
      terminalId: string;
      createdAt: string;
      message: string;
    }
  | {
      type: "cleared";
      threadId: string;
      terminalId: string;
      createdAt: string;
    }
  | {
      type: "restarted";
      threadId: string;
      terminalId: string;
      createdAt: string;
      snapshot: TerminalSessionSnapshot;
    };

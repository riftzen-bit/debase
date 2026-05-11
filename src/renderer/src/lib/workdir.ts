import type { Project, Thread } from "../state/types";

export function threadCwd(project: Project, thread: Thread): string {
  return thread.worktreePath || project.path;
}

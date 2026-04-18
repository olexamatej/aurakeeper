import { runShellCommand } from "../commands";
import type { CommandResult, PreparedWorkspace, VerificationCommand } from "../types";

export async function runLocalCommand(
  workspace: PreparedWorkspace,
  command: VerificationCommand
): Promise<CommandResult> {
  return runShellCommand(command, {
    cwd: workspace.workspacePath,
    timeoutMs: command.timeoutMs ?? workspace.config.limits?.commandTimeoutMs ?? 120_000,
  });
}

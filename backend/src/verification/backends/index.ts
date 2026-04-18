import { runDockerCommand } from "./docker";
import { runLocalCommand } from "./local";
import type {
  CommandResult,
  ExecutionBackendId,
  PreparedWorkspace,
  VerificationCommand,
} from "../types";

export async function runBackendCommand(
  backend: ExecutionBackendId,
  workspace: PreparedWorkspace,
  command: VerificationCommand
): Promise<CommandResult> {
  if (backend === "docker") {
    return runDockerCommand(workspace, command);
  }

  return runLocalCommand(workspace, command);
}

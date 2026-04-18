import { runProcess } from "../commands";
import type { CommandResult, PreparedWorkspace, VerificationCommand } from "../types";

function dockerNetworkFor(command: VerificationCommand): string {
  return command.network === "enabled" ? "bridge" : "none";
}

export async function runDockerCommand(
  workspace: PreparedWorkspace,
  command: VerificationCommand
): Promise<CommandResult> {
  const image = workspace.config.docker?.image ?? workspace.profile.defaultDockerImage;
  const cpus = workspace.config.limits?.cpus;
  const memory = workspace.config.limits?.memory;
  const args = [
    "run",
    "--rm",
    "--network",
    dockerNetworkFor(command),
    "-v",
    `${workspace.workspacePath}:/workspace`,
    "-w",
    "/workspace",
  ];

  if (cpus && cpus > 0) {
    args.push("--cpus", String(cpus));
  }

  if (memory) {
    args.push("--memory", memory);
  }

  args.push(image, "sh", "-lc", command.command);

  return runProcess("docker", args, command, {
    cwd: workspace.workspacePath,
    timeoutMs: command.timeoutMs ?? workspace.config.limits?.commandTimeoutMs ?? 120_000,
  });
}

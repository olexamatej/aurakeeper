import { spawn } from "node:child_process";

import type { CommandResult, VerificationCommand } from "./types";

const MAX_CAPTURED_OUTPUT = 128 * 1024;

type ProcessOptions = {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
};

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");

  if (next.length <= MAX_CAPTURED_OUTPUT) {
    return next;
  }

  return next.slice(next.length - MAX_CAPTURED_OUTPUT);
}

export function createSkippedResult(
  command: VerificationCommand,
  skipReason: string
): CommandResult {
  return {
    id: command.id,
    command: command.command,
    phase: command.phase,
    suite: command.suite,
    source: command.source,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    skipped: true,
    skipReason,
  };
}

export function runProcess(
  file: string,
  args: string[],
  command: VerificationCommand,
  options: ProcessOptions
): Promise<CommandResult> {
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      resolve({
        id: command.id,
        command: command.command,
        phase: command.phase,
        suite: command.suite,
        source: command.source,
        exitCode: null,
        stdout,
        stderr: stderr || error.message,
        durationMs: Date.now() - startedAt,
        timedOut,
        skipped: false,
      });
    });

    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      resolve({
        id: command.id,
        command: command.command,
        phase: command.phase,
        suite: command.suite,
        source: command.source,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        skipped: false,
      });
    });
  });
}

export function runShellCommand(
  command: VerificationCommand,
  options: ProcessOptions
): Promise<CommandResult> {
  return runProcess("sh", ["-lc", command.command], command, options);
}

export async function checkDockerAvailable(timeoutMs = 3000): Promise<boolean> {
  const result = await runProcess(
    "docker",
    ["info"],
    {
      id: "docker-available",
      command: "docker info",
      phase: "setup",
      source: "profile",
    },
    {
      cwd: process.cwd(),
      timeoutMs,
    }
  );

  return result.exitCode === 0 && !result.timedOut;
}

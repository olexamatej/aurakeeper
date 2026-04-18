import { config } from "../config";
import type { AgentResult, AgentTask, RepairAgentClient } from "./orchestrator";
import {
  buildRepairAgentPrompt,
  defaultCliRunner,
  parseCliAgentEnvelope,
  type CliRunner,
} from "./cli-agent-shared";

const DEFAULT_PI_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export type PiCliRunner = CliRunner;

export type PiCliAgentClientOptions = {
  piPath?: string;
  provider?: string;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  extraArgs?: string[];
  runner?: PiCliRunner;
};

function buildArgs(
  options: PiCliAgentClientOptions
): string[] {
  const args = [
    "--print",
    "--mode",
    "text",
    "--no-session",
    "--tools",
    DEFAULT_PI_TOOLS.join(","),
  ];

  if (options.provider) {
    args.push("--provider", options.provider);
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.thinking) {
    args.push("--thinking", options.thinking);
  }

  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }

  return args;
}

export class PiCliAgentClient implements RepairAgentClient {
  private readonly piPath: string;
  private readonly provider?: string;
  private readonly model?: string;
  private readonly thinking?: PiCliAgentClientOptions["thinking"];
  private readonly extraArgs?: string[];
  private readonly runner: PiCliRunner;

  constructor(options: PiCliAgentClientOptions = {}) {
    this.piPath = options.piPath ?? config.pi.path;
    this.provider = options.provider ?? config.pi.provider;
    this.model = options.model ?? config.pi.model;
    this.thinking = options.thinking ?? config.pi.thinking;
    this.extraArgs = options.extraArgs;
    this.runner = options.runner ?? defaultCliRunner;
  }

  async run<TInput, TOutput>(
    task: AgentTask<TInput>
  ): Promise<AgentResult<TOutput>> {
    const prompt = buildRepairAgentPrompt(task, "Pi");
    const execution = await this.runner({
      command: this.piPath,
      args: buildArgs({
        provider: this.provider,
        model: this.model,
        thinking: this.thinking,
        extraArgs: this.extraArgs,
      }),
      cwd: task.repository.checkoutPath,
      stdin: prompt,
    });

    if (execution.exitCode !== 0) {
      throw new Error(
        [
          `Pi CLI exited with code ${execution.exitCode}.`,
          execution.stderr.trim() ? `stderr:\n${execution.stderr.trim()}` : undefined,
          execution.stdout.trim() ? `stdout:\n${execution.stdout.trim()}` : undefined,
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    const parsed = parseCliAgentEnvelope<TOutput>(execution.stdout, "Pi");

    return {
      output: parsed.output,
      artifacts: parsed.artifacts,
      raw: {
        stdout: execution.stdout,
        stderr: execution.stderr,
        finalMessage: parsed,
      },
    };
  }
}

export function createPiCliAgentClient(
  options: PiCliAgentClientOptions = {}
): RepairAgentClient {
  return new PiCliAgentClient(options);
}

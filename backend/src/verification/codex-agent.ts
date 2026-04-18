import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "../config";
import type { AgentResult, AgentTask, RepairAgentClient } from "./orchestrator";
import {
  buildRepairAgentPrompt,
  defaultCliRunner,
  outputSchemaForRole,
  type CliAgentEnvelope,
  type CliRunner,
} from "./cli-agent-shared";

export type CodexCliRunner = CliRunner;

export type CodexCliAgentClientOptions = {
  codexPath?: string;
  model?: string;
  profile?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  extraArgs?: string[];
  runner?: CodexCliRunner;
};

const DEFAULT_SANDBOX = "workspace-write";

function buildArgs(
  task: AgentTask<unknown>,
  schemaPath: string,
  outputPath: string,
  options: CodexCliAgentClientOptions
): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    options.sandbox ?? DEFAULT_SANDBOX,
    "--json",
    "--color",
    "never",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "-C",
    task.repository.checkoutPath,
    "--add-dir",
    task.artifactsDir,
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.profile) {
    args.push("--profile", options.profile);
  }

  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }

  args.push("-");

  return args;
}

export class CodexCliAgentClient implements RepairAgentClient {
  private readonly codexPath: string;
  private readonly model?: string;
  private readonly profile?: string;
  private readonly sandbox?: CodexCliAgentClientOptions["sandbox"];
  private readonly extraArgs?: string[];
  private readonly runner: CodexCliRunner;

  constructor(options: CodexCliAgentClientOptions = {}) {
    this.codexPath = options.codexPath ?? config.codex.path;
    this.model = options.model ?? config.codex.model;
    this.profile = options.profile ?? config.codex.profile;
    this.sandbox = options.sandbox ?? config.codex.sandbox;
    this.extraArgs = options.extraArgs;
    this.runner = options.runner ?? defaultCliRunner;
  }

  async run<TInput, TOutput>(
    task: AgentTask<TInput>
  ): Promise<AgentResult<TOutput>> {
    const tempDir = await mkdtemp(join(tmpdir(), "aurakeeper-codex-agent-"));
    const schemaPath = join(tempDir, `${task.role}-schema.json`);
    const outputPath = join(tempDir, `${task.role}-output.json`);
    const prompt = buildRepairAgentPrompt(task, "Codex");

    try {
      await writeFile(
        schemaPath,
        `${JSON.stringify(outputSchemaForRole(task.role), null, 2)}\n`
      );

      const execution = await this.runner({
        command: this.codexPath,
        args: buildArgs(task, schemaPath, outputPath, {
          codexPath: this.codexPath,
          model: this.model,
          profile: this.profile,
          sandbox: this.sandbox,
          extraArgs: this.extraArgs,
        }),
        cwd: task.repository.checkoutPath,
        stdin: prompt,
      });

      if (execution.exitCode !== 0) {
        throw new Error(
          [
            `Codex CLI exited with code ${execution.exitCode}.`,
            execution.stderr.trim() ? `stderr:\n${execution.stderr.trim()}` : undefined,
            execution.stdout.trim() ? `stdout:\n${execution.stdout.trim()}` : undefined,
          ]
            .filter(Boolean)
            .join("\n\n")
        );
      }

      const rawOutput = await readFile(outputPath, "utf8");
      const parsed = JSON.parse(rawOutput) as CliAgentEnvelope<TOutput>;

      return {
        output: parsed.output,
        artifacts: parsed.artifacts,
        raw: {
          stdout: execution.stdout,
          stderr: execution.stderr,
          finalMessage: parsed,
        },
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export function createCodexCliAgentClient(
  options: CodexCliAgentClientOptions = {}
): RepairAgentClient {
  return new CodexCliAgentClient(options);
}

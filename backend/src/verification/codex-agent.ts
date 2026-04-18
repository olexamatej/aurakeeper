import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "../config";
import type {
  AgentResult,
  AgentTask,
  AgentRole,
  RepairAgentClient,
} from "./orchestrator";

type CodexCliRunnerInput = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
};

type CodexCliRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CodexCliRunner = (
  input: CodexCliRunnerInput
) => Promise<CodexCliRunnerResult>;

export type CodexCliAgentClientOptions = {
  codexPath?: string;
  model?: string;
  profile?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  extraArgs?: string[];
  runner?: CodexCliRunner;
};

type CodexCliAgentEnvelope<TOutput> = {
  output: TOutput;
  artifacts?: string[];
};

const DEFAULT_SANDBOX = "workspace-write";

function escapeFence(value: string): string {
  return value.replaceAll("```", "\\`\\`\\`");
}

function nullableStringSchema(): Record<string, unknown> {
  return {
    type: ["string", "null"],
  };
}

function nullableIntegerSchema(): Record<string, unknown> {
  return {
    type: ["integer", "null"],
  };
}

function nullableStringArraySchema(): Record<string, unknown> {
  return {
    type: ["array", "null"],
    items: { type: "string" },
  };
}

function nullableObjectArraySchema(itemSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: ["array", "null"],
    items: itemSchema,
  };
}

function schemaForRole(role: AgentRole): Record<string, unknown> {
  switch (role) {
    case "replicator":
      return {
        type: "object",
        additionalProperties: false,
        required: [
          "status",
          "handoff",
          "handoffPath",
          "tldr",
          "likelyCause",
          "reproductionCommands",
          "commandsRun",
          "affectedFiles",
          "confidence",
          "remainingUncertainty",
        ],
        properties: {
          status: {
            type: "string",
            enum: ["reproduced", "not_reproduced", "needs_context"],
          },
          handoff: nullableStringSchema(),
          handoffPath: nullableStringSchema(),
          tldr: nullableStringSchema(),
          likelyCause: nullableStringSchema(),
          reproductionCommands: nullableStringArraySchema(),
          commandsRun: nullableObjectArraySchema(commandLogSchema()),
          affectedFiles: nullableStringArraySchema(),
          confidence: nullableStringSchema(),
          remainingUncertainty: nullableStringSchema(),
        },
      };
    case "worker":
      return {
        type: "object",
        additionalProperties: false,
        required: [
          "status",
          "issueSummary",
          "suspectedRootCause",
          "filesChanged",
          "locChanged",
          "patch",
          "verificationCommands",
          "confidence",
          "remainingRisk",
        ],
        properties: {
          status: {
            type: "string",
            enum: ["patched", "blocked", "needs_context"],
          },
          issueSummary: nullableStringSchema(),
          suspectedRootCause: nullableStringSchema(),
          filesChanged: nullableStringArraySchema(),
          locChanged: nullableIntegerSchema(),
          patch: nullableStringSchema(),
          verificationCommands: nullableObjectArraySchema(commandLogSchema()),
          confidence: nullableStringSchema(),
          remainingRisk: nullableStringSchema(),
        },
      };
    case "tester":
      return {
        type: "object",
        additionalProperties: false,
        required: [
          "status",
          "prGate",
          "originalIssueVerification",
          "regressionSummary",
          "commandsReviewed",
          "skippedSuites",
          "artifactsReviewed",
          "confidence",
          "remainingRisk",
        ],
        properties: {
          status: {
            type: "string",
            enum: ["passed", "failed", "blocked", "inconclusive"],
          },
          prGate: {
            type: "string",
            enum: ["allow", "block"],
          },
          originalIssueVerification: nullableStringSchema(),
          regressionSummary: nullableStringSchema(),
          commandsReviewed: nullableStringArraySchema(),
          skippedSuites: nullableObjectArraySchema({
            type: "object",
            additionalProperties: false,
            required: ["suite", "reason"],
            properties: {
              suite: {
                type: "string",
                enum: ["targeted", "standard", "fuzz", "full"],
              },
              reason: { type: "string" },
            },
          }),
          artifactsReviewed: nullableStringArraySchema(),
          confidence: nullableStringSchema(),
          remainingRisk: nullableStringSchema(),
        },
      };
  }
}

function commandLogSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["command", "exitCode", "stdout", "stderr", "durationMs", "notes"],
    properties: {
      command: { type: "string" },
      exitCode: nullableIntegerSchema(),
      stdout: nullableStringSchema(),
      stderr: nullableStringSchema(),
      durationMs: nullableIntegerSchema(),
      notes: nullableStringSchema(),
    },
  };
}

function outputSchemaForRole(role: AgentRole): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["output", "artifacts"],
    properties: {
      output: schemaForRole(role),
      artifacts: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function buildPrompt<TInput>(task: AgentTask<TInput>): string {
  const roleName = `${task.role[0]?.toUpperCase() ?? ""}${task.role.slice(1)}`;
  const browser = task.capabilities?.browser;
  const capabilityNotes = browser
    ? [
        "Runtime Capability Notes:",
        "- Browser automation is exposed as a shell command, not as a built-in Codex tool.",
        `- Run \`${browser.command}\` from the terminal when you need browser automation.`,
        browser.targetUrl
          ? `- Start with \`${browser.command} open ${browser.targetUrl}\`, then inspect refs with \`${browser.command} snapshot -i --json\`.`
          : `- Start with \`${browser.command} open <url>\`, then inspect refs with \`${browser.command} snapshot -i --json\`.`,
        `- Save required screenshots with \`${browser.command} screenshot <path>\` into ${browser.screenshotDir}.`,
        "",
      ]
    : [];

  return [
    `You are AuraKeeper's ${roleName} agent, running through the Codex CLI.`,
    "Follow the supplied role instructions exactly, using the repository checkout as your working tree.",
    `Store any files you create for this run inside this artifacts directory: ${task.artifactsDir}`,
    "Return only a JSON object that matches the provided output schema.",
    "Important: include every schema field. Use null for unavailable scalar values and [] for unavailable arrays.",
    "",
    ...capabilityNotes,
    "Role Instructions:",
    "```markdown",
    escapeFence(task.prompt.content),
    "```",
    "",
    "Task Payload:",
    "```json",
    JSON.stringify(task, null, 2),
    "```",
  ].join("\n");
}

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

async function defaultRunner(input: CodexCliRunnerInput): Promise<CodexCliRunnerResult> {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: process.env,
    stdio: "pipe",
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write(input.stdin);
  child.stdin.end();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  return {
    exitCode,
    stdout,
    stderr,
  };
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
    this.runner = options.runner ?? defaultRunner;
  }

  async run<TInput, TOutput>(
    task: AgentTask<TInput>
  ): Promise<AgentResult<TOutput>> {
    const tempDir = await mkdtemp(join(tmpdir(), "aurakeeper-codex-agent-"));
    const schemaPath = join(tempDir, `${task.role}-schema.json`);
    const outputPath = join(tempDir, `${task.role}-output.json`);
    const prompt = buildPrompt(task);

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
      const parsed = JSON.parse(rawOutput) as CodexCliAgentEnvelope<TOutput>;

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

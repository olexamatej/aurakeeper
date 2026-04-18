import { spawn } from "node:child_process";

import type { AgentRole, AgentTask } from "./orchestrator";

export type CliRunnerInput = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  env?: NodeJS.ProcessEnv;
};

export type CliRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliRunner = (input: CliRunnerInput) => Promise<CliRunnerResult>;

export type CliAgentEnvelope<TOutput> = {
  output: TOutput;
  artifacts?: string[];
};

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

export function outputSchemaForRole(role: AgentRole): Record<string, unknown> {
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

export function buildRepairAgentPrompt<TInput>(
  task: AgentTask<TInput>,
  cliName: string
): string {
  const roleName = `${task.role[0]?.toUpperCase() ?? ""}${task.role.slice(1)}`;
  const browser = task.capabilities?.browser;
  const capabilityNotes = browser
    ? [
        "Runtime Capability Notes:",
        `- Browser automation is exposed as a shell command, not as a built-in ${cliName} tool.`,
        `- Run \`${browser.command}\` from the terminal when you need browser automation.`,
        browser.targetUrl
          ? `- Start with \`${browser.command} open ${browser.targetUrl}\`, then inspect refs with \`${browser.command} snapshot -i --json\`.`
          : `- Start with \`${browser.command} open <url>\`, then inspect refs with \`${browser.command} snapshot -i --json\`.`,
        `- Save required screenshots with \`${browser.command} screenshot <path>\` into ${browser.screenshotDir}.`,
        "- Never fabricate, synthesize, or placeholder browser screenshots. If browser automation fails, explain that and leave the screenshot missing.",
        "",
      ]
    : [];
  const workerPatchNotes = task.role === "worker"
    ? [
        "Worker Patch Notes:",
        "- The `patch` field must be a unified diff that `git apply` can consume.",
        "- Do not return an `apply_patch` block or any prose in the `patch` field.",
        "- Start the patch with `diff --git a/... b/...`.",
        "",
      ]
    : [];

  return [
    `You are AuraKeeper's ${roleName} agent, running through the ${cliName} CLI.`,
    "Follow the supplied role instructions exactly, using the repository checkout as your working tree.",
    `Store any files you create for this run inside this artifacts directory: ${task.artifactsDir}`,
    "Return only a JSON object that matches the provided output schema.",
    "Do not wrap the JSON in markdown fences or include any extra commentary.",
    "Important: include every schema field. Use null for unavailable scalar values and [] for unavailable arrays.",
    "",
    ...capabilityNotes,
    ...workerPatchNotes,
    "Output Schema:",
    "```json",
    JSON.stringify(outputSchemaForRole(task.role), null, 2),
    "```",
    "",
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

export async function defaultCliRunner(input: CliRunnerInput): Promise<CliRunnerResult> {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env ?? process.env,
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

export function parseCliAgentEnvelope<TOutput>(
  rawOutput: string,
  cliName: string
): CliAgentEnvelope<TOutput> {
  const trimmed = rawOutput.trim();

  if (!trimmed) {
    throw new Error(`${cliName} CLI did not return any JSON output.`);
  }

  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as CliAgentEnvelope<TOutput>;
    } catch {
      continue;
    }
  }

  throw new Error(`${cliName} CLI returned output that was not valid JSON.`);
}

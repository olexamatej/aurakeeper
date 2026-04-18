import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type HookAgentResult = {
  summary: string | null;
  detectedStack: string | null;
  strategy: "template" | "project_specific" | "mixed" | null;
  filesChanged: string[];
  nextSteps: string[];
};

type HookAgentResultEnvelope = {
  output?: HookAgentResult;
};

const HOOK_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "detectedStack", "strategy", "filesChanged", "nextSteps"],
  properties: {
    summary: { type: ["string", "null"] },
    detectedStack: { type: ["string", "null"] },
    strategy: {
      type: ["string", "null"],
      enum: ["template", "project_specific", "mixed", null],
    },
    filesChanged: {
      type: "array",
      items: { type: "string" },
    },
    nextSteps: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

function runCommand(command: string, args: string[], cwd: string, stdin: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function isHookAgentResult(value: unknown): value is HookAgentResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    ("summary" in candidate) &&
    ("detectedStack" in candidate) &&
    ("strategy" in candidate) &&
    Array.isArray(candidate.filesChanged) &&
    Array.isArray(candidate.nextSteps)
  );
}

function parseHookAgentOutput(raw: string): HookAgentResult {
  const parsed = JSON.parse(raw) as HookAgentResult | HookAgentResultEnvelope;

  if (isHookAgentResult(parsed)) {
    return parsed;
  }

  if (isHookAgentResult(parsed.output)) {
    return parsed.output;
  }

  throw new Error("Hook agent returned JSON in an unexpected shape.");
}

export async function runHookAgent(input: {
  cwd: string;
  prompt: string;
}): Promise<HookAgentResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "aurakeeper-hook-"));
  const schemaPath = join(tempDir, "hook-schema.json");
  const outputPath = join(tempDir, "hook-output.json");
  const codexPath = process.env.AURAKEEPER_CODEX_PATH ?? process.env.CODEX_PATH ?? "codex";

  try {
    await writeFile(schemaPath, `${JSON.stringify(HOOK_OUTPUT_SCHEMA, null, 2)}\n`);

    const execution = await runCommand(
      codexPath,
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--json",
        "--color",
        "never",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-C",
        input.cwd,
        "-",
      ],
      input.cwd,
      input.prompt
    );

    if (execution.exitCode !== 0) {
      throw new Error(
        [
          `Codex exited with code ${execution.exitCode}.`,
          execution.stderr.trim() ? `stderr:\n${execution.stderr.trim()}` : undefined,
          execution.stdout.trim() ? `stdout:\n${execution.stdout.trim()}` : undefined,
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    return parseHookAgentOutput(await readFile(outputPath, "utf8"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

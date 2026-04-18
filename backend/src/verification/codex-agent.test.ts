import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";

import type { AgentTask } from "./orchestrator";
import { CodexCliAgentClient } from "./codex-agent";

function createTask(role: AgentTask<unknown>["role"]): AgentTask<unknown> {
  return {
    id: `repair_test:${role}`,
    role,
    repairAttemptId: "repair_test",
    prompt: {
      role,
      path: "/tmp/prompt.md",
      content: `Role prompt for ${role}`,
    },
    repository: {
      checkoutPath: "/tmp/repo",
    },
    codebase: {
      rootPath: "/tmp/repo",
      profile: {
        id: "generic",
        displayName: "Generic",
        defaultDockerImage: "node:20",
      },
      projectConfig: {},
      fileTree: ["src/index.ts"],
      fileTreeTruncated: false,
      instructions: [],
      contracts: [],
      projectDocuments: [],
      relevantFiles: [],
      limits: {
        maxFileTreeEntries: 800,
        maxProjectDocuments: 40,
        maxRelevantFiles: 12,
        maxContextFileBytes: 64 * 1024,
      },
    },
    sandbox: {
      selectedBackend: "local",
      backendReason: "selected for test",
      backendFallback: false,
      dockerAvailable: false,
      dockerImage: "node:20",
      environment: "local",
      trustLevel: "trusted",
      suites: ["targeted"],
    },
    input: {
      error: {
        message: "boom",
      },
    },
    artifactsDir: "/tmp/artifacts",
    createdAt: "2026-04-18T08:32:17Z",
  };
}

describe("CodexCliAgentClient", () => {
  test("invokes codex exec with schema-validated JSON output", async () => {
    const client = new CodexCliAgentClient({
      codexPath: "/mock/codex",
      model: "gpt-5.4",
      profile: "default",
      runner: async ({ command, args, cwd, stdin }) => {
        expect(command).toBe("/mock/codex");
        expect(cwd).toBe("/tmp/repo");
        expect(args).toContain("exec");
        expect(args).toContain("--output-schema");
        expect(args).toContain("--output-last-message");
        expect(args).toContain("--model");
        expect(args).toContain("gpt-5.4");
        expect(args).toContain("--profile");
        expect(args).toContain("default");
        expect(args).toContain("--add-dir");
        expect(args).toContain("/tmp/artifacts");
        expect(stdin).toContain("Role prompt for worker");
        expect(stdin).toContain('"repairAttemptId": "repair_test"');

        const outputPath = args[args.indexOf("--output-last-message") + 1] as string;
        const schemaPath = args[args.indexOf("--output-schema") + 1] as string;
        const schema = await readFile(schemaPath, "utf8");

        expect(schema).toContain('"status"');
        expect(schema).toContain('"patched"');

        await writeFile(
          outputPath,
          `${JSON.stringify({
            output: {
              status: "patched",
              issueSummary: "Fix stale value",
              suspectedRootCause: "Old value remained in file",
              patch: "diff --git a/a b/a",
              filesChanged: ["src/index.ts"],
              locChanged: 1,
              verificationCommands: [],
              confidence: "high",
              remainingRisk: null,
            },
            artifacts: ["worker-report.md"],
          })}\n`
        );

        return {
          exitCode: 0,
          stdout: '{"event":"done"}\n',
          stderr: "",
        };
      },
    });

    const result = await client.run(createTask("worker"));

    expect(result.output).toMatchObject({
      status: "patched",
      filesChanged: ["src/index.ts"],
    });
    expect(result.artifacts).toEqual(["worker-report.md"]);
    expect(result.raw).toMatchObject({
      stdout: '{"event":"done"}\n',
      stderr: "",
    });
  });

  test("surfaces codex cli failures with captured output", async () => {
    const client = new CodexCliAgentClient({
      codexPath: "/mock/codex",
      runner: async () => ({
        exitCode: 3,
        stdout: "some stdout",
        stderr: "some stderr",
      }),
    });

    await expect(client.run(createTask("replicator"))).rejects.toThrow(
      /Codex CLI exited with code 3/
    );
  });
});

import { describe, expect, test } from "bun:test";

import type { AgentTask } from "./orchestrator";
import { PiCliAgentClient } from "./pi-agent";

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

describe("PiCliAgentClient", () => {
  test("invokes pi in print mode and parses JSON output", async () => {
    const client = new PiCliAgentClient({
      piPath: "/mock/pi",
      provider: "openai",
      model: "gpt-4o",
      thinking: "medium",
      runner: async ({ command, args, cwd, stdin }) => {
        expect(command).toBe("/mock/pi");
        expect(cwd).toBe("/tmp/repo");
        expect(args).toEqual(
          expect.arrayContaining([
            "--print",
            "--mode",
            "text",
            "--no-session",
            "--tools",
            "read,bash,edit,write,grep,find,ls",
            "--provider",
            "openai",
            "--model",
            "gpt-4o",
            "--thinking",
            "medium",
          ])
        );
        expect(stdin).toContain("Role prompt for worker");
        expect(stdin).toContain('"repairAttemptId": "repair_test"');
        expect(stdin).toContain('"status"');

        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
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
          })}\n`,
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
  });

  test("surfaces pi cli failures with captured output", async () => {
    const client = new PiCliAgentClient({
      piPath: "/mock/pi",
      runner: async () => ({
        exitCode: 4,
        stdout: "some stdout",
        stderr: "some stderr",
      }),
    });

    await expect(client.run(createTask("replicator"))).rejects.toThrow(
      /Pi CLI exited with code 4/
    );
  });
});

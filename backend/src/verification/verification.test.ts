import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  orchestrateRepair,
  selectExecutionBackend,
  type AgentResult,
  type AgentTask,
  type RepairAgentClient,
  type ReplicatorAgentOutput,
  type TesterAgentInput,
  type TesterAgentOutput,
  type WorkerAgentOutput,
} from "./orchestrator";
import { nodeProfile } from "./profiles";
import { normalizeProjectVerificationConfig } from "./project-config";
import { applyWorkerPatch, cleanupWorkspace, createArtifactsDir, prepareWorkspace } from "./workspace";

function fakePngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe("execution backend selection", () => {
  test("selects docker for production repair attempts", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: true,
      environment: "production",
      trustLevel: "untrusted",
      requiredSuites: ["targeted"],
    });

    expect(decision).toMatchObject({
      status: "selected",
      backend: "docker",
      fallback: false,
    });
  });

  test("selects local for trusted local development runs", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: true,
      environment: "local",
      trustLevel: "trusted",
      requiredSuites: ["standard"],
    });

    expect(decision).toMatchObject({
      status: "selected",
      backend: "local",
      fallback: false,
    });
  });

  test("falls back to local when docker is unavailable and project is trusted", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: false,
      environment: "production",
      trustLevel: "trusted",
      requiredSuites: ["standard"],
      config: {
        execution: {
          allowedBackends: ["docker", "local"],
        },
      },
    });

    expect(decision).toMatchObject({
      status: "selected",
      backend: "local",
      fallback: true,
    });
  });

  test("blocks untrusted projects when docker is unavailable", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: false,
      environment: "production",
      trustLevel: "untrusted",
      requiredSuites: ["standard"],
    });

    expect(decision).toMatchObject({
      status: "blocked",
      fallback: false,
    });
  });
});

describe("technology profiles", () => {
  test("maps node package scripts to standard verification commands", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "aurakeeper-node-profile-"));

    try {
      await writeFile(
        join(rootPath, "package.json"),
        JSON.stringify({
          scripts: {
            test: "node test.js",
            lint: "eslint .",
            build: "tsc",
          },
        })
      );

      const commands = await nodeProfile.buildCommands({
        rootPath,
        changedFiles: [],
        selectedSuites: ["standard"],
        config: {},
      });

      expect(commands.map((command) => command.command)).toContain("npm run test");
      expect(commands.map((command) => command.command)).toContain("npm run lint");
      expect(commands.map((command) => command.command)).toContain("npm run build");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

describe("project verification config", () => {
  test("normalizes browser automation settings", () => {
    const config = normalizeProjectVerificationConfig({
      browser: {
        enabled: true,
        roles: ["replicator", "tester", "worker"],
        command: "agent-browser",
        configPath: "config/agent-browser.json",
        remoteProvider: "browserbase",
        headed: true,
        sessionName: "frontend-bug",
        startupCommand: "pnpm dev",
        startupCwd: "frontend",
        startupTimeoutMs: 45_000,
        targetUrl: "http://127.0.0.1:3000/dashboard",
        healthcheckUrl: "http://127.0.0.1:3000/api/health",
        waitForUrl: "**/dashboard",
        allowedDomains: ["127.0.0.1", "localhost"],
      },
    });

    expect(config.browser).toEqual({
      enabled: true,
      roles: ["replicator", "tester"],
      command: "agent-browser",
      configPath: "config/agent-browser.json",
      remoteProvider: "browserbase",
      headed: true,
      sessionName: "frontend-bug",
      startupCommand: "pnpm dev",
      startupCwd: "frontend",
      startupTimeoutMs: 45_000,
      targetUrl: "http://127.0.0.1:3000/dashboard",
      healthcheckUrl: "http://127.0.0.1:3000/api/health",
      waitForUrl: "**/dashboard",
      allowedDomains: ["127.0.0.1", "localhost"],
    });
  });
});

describe("local workspace safety", () => {
  test("applies worker patches directly in the source checkout", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-source-"));
    const artifactsDir = await createArtifactsDir();

    try {
      await mkdir(join(sourcePath, "src"));
      await writeFile(join(sourcePath, "src", "value.txt"), "old\n");

      const patch = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1 @@
-old
+new
`;
      const workspace = await prepareWorkspace({
        backend: "local",
        request: {
          repairAttemptId: "attempt_test",
          repository: {
            checkoutPath: sourcePath,
          },
          patch,
          keepWorkspace: true,
        },
        profile: nodeProfile,
        config: {},
        artifactsDir,
      });

      const result = await applyWorkerPatch(workspace, {
        repairAttemptId: "attempt_test",
        repository: {
          checkoutPath: sourcePath,
        },
        patch,
      });

      expect(result.applied).toBe(true);
      expect(workspace.workspacePath).toBe(sourcePath);
      expect(await readFile(join(workspace.workspacePath, "src", "value.txt"), "utf8")).toBe("new\n");
      expect(await readFile(join(sourcePath, "src", "value.txt"), "utf8")).toBe("new\n");

      await cleanupWorkspace({
        ...workspace,
        keepWorkspace: false,
      });
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("treats an already-applied worker patch in the source checkout as success", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-source-"));
    const artifactsDir = await createArtifactsDir();

    try {
      await mkdir(join(sourcePath, "src"));
      await writeFile(join(sourcePath, "src", "value.txt"), "old\n");

      const patch = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1 @@
-old
+new
`;
      const workspace = await prepareWorkspace({
        backend: "local",
        request: {
          repairAttemptId: "attempt_test_reapply",
          repository: {
            checkoutPath: sourcePath,
          },
          patch,
          keepWorkspace: true,
        },
        profile: nodeProfile,
        config: {},
        artifactsDir,
      });

      const firstResult = await applyWorkerPatch(workspace, {
        repairAttemptId: "attempt_test_reapply",
        repository: {
          checkoutPath: sourcePath,
        },
        patch,
      });
      const secondResult = await applyWorkerPatch(workspace, {
        repairAttemptId: "attempt_test_reapply",
        repository: {
          checkoutPath: sourcePath,
        },
        patch,
      });

      expect(firstResult.applied).toBe(true);
      expect(secondResult.applied).toBe(true);
      expect(secondResult.error).toBeUndefined();
      expect(await readFile(join(workspace.workspacePath, "src", "value.txt"), "utf8")).toBe("new\n");
      expect(await readFile(join(sourcePath, "src", "value.txt"), "utf8")).toBe("new\n");

      await cleanupWorkspace({
        ...workspace,
        keepWorkspace: false,
      });
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("applies worker patches written in Codex apply_patch format", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-source-"));
    const artifactsDir = await createArtifactsDir();

    try {
      await mkdir(join(sourcePath, "src"));
      await writeFile(join(sourcePath, "src", "value.txt"), "old\n");

      const patch = `*** Begin Patch
*** Update File: src/value.txt
@@
-old
+new
*** End Patch`;
      const workspace = await prepareWorkspace({
        backend: "local",
        request: {
          repairAttemptId: "attempt_test_codex_apply_patch",
          repository: {
            checkoutPath: sourcePath,
          },
          patch,
          keepWorkspace: true,
        },
        profile: nodeProfile,
        config: {},
        artifactsDir,
      });

      const result = await applyWorkerPatch(workspace, {
        repairAttemptId: "attempt_test_codex_apply_patch",
        repository: {
          checkoutPath: sourcePath,
        },
        patch,
      });

      expect(result.applied).toBe(true);
      expect(result.error).toBeUndefined();
      expect(await readFile(join(workspace.workspacePath, "src", "value.txt"), "utf8")).toBe("new\n");
      expect(await readFile(join(sourcePath, "src", "value.txt"), "utf8")).toBe("new\n");
      expect(result.patch?.workspacePatch).toContain("diff --git a/src/value.txt b/src/value.txt");

      await cleanupWorkspace({
        ...workspace,
        keepWorkspace: false,
      });
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

describe("repair orchestration", () => {
  test("calls repair agents in order and verifies the worker patch in the source checkout", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-orchestrator-source-"));
    const artifactsDir = await createArtifactsDir();
    const calls: string[] = [];
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;
    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        calls.push(task.role);

        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "value.txt still contains old",
            tldr: "value is stale",
            likelyCause: "constant was not updated",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "targeted command passed after patch",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_orchestrator_test",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "node",
              language: "javascript",
            },
            error: {
              message: "expected new value",
              stack: "Error: expected new value\n    at readValue (value.txt:1:1)",
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
          },
        },
        agentClient
      );

      expect(calls).toEqual(["replicator", "worker", "tester"]);
      expect(report.status).toBe("passed");
      expect(report.prGate).toBe("allow");
      expect(report.stage).toBe("complete");
      expect(report.verification?.patchApplied).toBe(true);
      expect(report.verification?.sourcePatchStatus).toBe("applied");
      expect(report.codebaseContextPath).toBeTruthy();
      expect(await readFile(join(sourcePath, "value.txt"), "utf8")).toBe("new\n");
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("rebuilds the worker patch from checkout edits when the returned diff is malformed", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-orchestrator-source-"));
    const artifactsDir = await createArtifactsDir();
    const malformedPatch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1,2 +1,2 @@
 old
-buggy
+fixed
`;
    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "value.txt still contains buggy",
            tldr: "value is stale",
            likelyCause: "value.txt was never updated",
            reproductionCommands: ['test "$(cat value.txt)" = "fixed"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          await writeFile(join(task.repository.checkoutPath, "value.txt"), "fixed\n");

          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace buggy value",
            suspectedRootCause: "value.txt contains the buggy value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch: malformedPatch,
          };

          return { output: output as TOutput };
        }

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "targeted command passed after patch",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "buggy\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_orchestrator_malformed_patch",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "node",
              language: "javascript",
            },
            error: {
              message: "expected fixed value",
              stack: "Error: expected fixed value\n    at readValue (value.txt:1:1)",
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          suites: ["targeted"],
          config: {
            commands: {
              targeted: ['test "$(cat value.txt)" = "fixed"'],
            },
          },
          artifactsDir,
          keepWorkspace: true,
          dockerAvailable: false,
        },
        agentClient
      );

      expect(report.status).toBe("passed");
      expect(report.verification?.patchApplied).toBe(true);
      expect(report.verification?.failureReason).toBeUndefined();
      expect(report.verification?.patchFiles?.workspace).toBe("worker.workspace.patch");

      const workspacePatch = await readFile(join(artifactsDir, "worker.workspace.patch"), "utf8");
      expect(workspacePatch).toContain("diff --git a/value.txt b/value.txt");
      expect(workspacePatch).toContain("@@ -1 +1 @@");
      expect(workspacePatch).toContain("-buggy");
      expect(workspacePatch).toContain("+fixed");
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("runs replicator reproduction commands directly in the source checkout", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-orchestrator-source-"));
    const artifactsDir = await createArtifactsDir();
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;
    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "value.txt still contains old",
            tldr: "value is stale",
            likelyCause: "constant was not updated",
            reproductionCommands: [`cd ${sourcePath} && test "$(cat value.txt)" = "new"`],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "targeted command passed after patch",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_orchestrator_rewrite_replicator_paths",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "node",
              language: "javascript",
            },
            error: {
              message: "expected new value",
              stack: "Error: expected new value\n    at readValue (value.txt:1:1)",
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          suites: ["targeted"],
          artifactsDir,
          keepWorkspace: true,
          dockerAvailable: false,
        },
        agentClient
      );

      expect(report.status).toBe("passed");
      expect(report.verification?.patchApplied).toBe(true);
      expect(report.verification?.workspacePath).toBe(sourcePath);
      expect(report.verification?.commands[0]?.command).toContain(sourcePath);
      expect(await readFile(join(sourcePath, "value.txt"), "utf8")).toBe("new\n");
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("runs worker and tester directly in the source checkout", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-orchestrator-isolated-"));
    const artifactsDir = await createArtifactsDir();
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;
    const seenCheckouts = new Map<string, string>();

    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        seenCheckouts.set(task.role, task.repository.checkoutPath);

        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "value.txt still contains old",
            tldr: "value is stale",
            likelyCause: "constant was not updated",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          await writeFile(join(task.repository.checkoutPath, "worker-only.txt"), "temp worker file\n");

          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        await writeFile(join(task.repository.checkoutPath, "tester-only.txt"), "temp tester file\n");

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "targeted command passed after patch",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_orchestrator_isolated",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "node",
              language: "javascript",
            },
            error: {
              message: "expected new value",
              stack: "Error: expected new value\n    at readValue (value.txt:1:1)",
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
          },
        },
        agentClient
      );

      expect(report.status).toBe("passed");
      expect(report.verification?.sourcePatchStatus).toBe("applied");
      expect(seenCheckouts.get("worker")).toBe(sourcePath);
      expect(seenCheckouts.get("tester")).toBe(sourcePath);
      expect(await readFile(join(sourcePath, "value.txt"), "utf8")).toBe("new\n");
      expect(await readFile(join(sourcePath, "worker-only.txt"), "utf8")).toBe("temp worker file\n");
      expect(await readFile(join(sourcePath, "tester-only.txt"), "utf8")).toBe("temp tester file\n");
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("passes agent-browser capability to replicator and tester for frontend bugs", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-browser-orchestrator-source-"));
    const artifactsDir = await createArtifactsDir();
    const calls: string[] = [];
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;
    let testerWorkspaceValue = "";

    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        calls.push(task.role);

        if (task.role === "replicator") {
          await writeFile(
            join(artifactsDir, "replicator-browser-current.png"),
            fakePngBuffer(1280, 720)
          );

          expect(task.capabilities?.browser).toMatchObject({
            provider: "agent-browser",
            command: "agent-browser",
            startupCommand: "pnpm dev -- --hostname 127.0.0.1",
            targetUrl: "http://127.0.0.1:3000/dashboard",
            workspacePath: sourcePath,
            screenshotDir: artifactsDir,
            requiredScreenshots: ["replicator-browser-current.png"],
          });

          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "dashboard shows stale value",
            tldr: "dashboard UI is stale",
            likelyCause: "frontend still renders the old value",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        expect(task.capabilities?.browser).toBeTruthy();
        await writeFile(
          join(artifactsDir, "tester-browser-before-fix.png"),
          fakePngBuffer(1280, 720)
        );
        await writeFile(
          join(artifactsDir, "tester-browser-after-fix.png"),
          fakePngBuffer(1280, 720)
        );
        expect(task.capabilities?.browser).toMatchObject({
          screenshotDir: artifactsDir,
          requiredScreenshots: [
            "tester-browser-before-fix.png",
            "tester-browser-after-fix.png",
          ],
        });
        testerWorkspaceValue = await readFile(
          join(task.capabilities?.browser?.workspacePath as string, "value.txt"),
          "utf8"
        );

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "browser verification can inspect the patched workspace",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_browser_orchestrator_test",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "web",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "browser",
              language: "typescript",
              framework: "react",
            },
            error: {
              message: "dashboard shows stale value",
            },
            context: {
              request: {
                url: "http://127.0.0.1:3000/dashboard",
              },
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
            browser: {
              enabled: true,
              command: "agent-browser",
              startupCommand: "pnpm dev",
              targetUrl: "http://127.0.0.1:3000/dashboard",
            },
          },
        },
        agentClient,
        {
          browserCommandAvailable: async (command) => command === "agent-browser",
        }
      );

      expect(calls).toEqual(["replicator", "worker", "tester"]);
      expect(report.status).toBe("passed");
      expect(report.prGate).toBe("allow");
      expect(testerWorkspaceValue).toBe("new\n");
      expect(report.verification?.sourcePatchStatus).toBe("applied");
      expect(await readFile(join(sourcePath, "value.txt"), "utf8")).toBe("new\n");
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("blocks browser-capable agent runs that fabricate 1x1 screenshots", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-browser-invalid-shot-"));
    const artifactsDir = await createArtifactsDir();
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;

    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        if (task.role === "replicator") {
          await writeFile(
            join(artifactsDir, "replicator-browser-current.png"),
            fakePngBuffer(1, 1)
          );

          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "dashboard shows stale value",
            tldr: "dashboard UI is stale",
            likelyCause: "frontend still renders the old value",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        const output: TesterAgentOutput = {
          status: "passed",
          prGate: "allow",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_browser_invalid_screenshot",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "web",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "browser",
              language: "typescript",
              framework: "react",
            },
            error: {
              message: "dashboard shows stale value",
            },
            context: {
              request: {
                url: "http://127.0.0.1:3000/dashboard",
              },
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
            browser: {
              enabled: true,
              command: "agent-browser",
              targetUrl: "http://127.0.0.1:3000/dashboard",
            },
          },
        },
        agentClient,
        {
          browserCommandAvailable: async () => true,
        }
      );

      expect(report.status).toBe("blocked");
      expect(report.stage).toBe("replicator");
      expect(report.failureReason).toContain("implausibly small (1x1)");
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("skips browser capability when the command is unavailable", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-browser-disabled-source-"));
    const artifactsDir = await createArtifactsDir();
    const browserCapabilitySeenByRole = new Map<string, boolean>();
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;

    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        browserCapabilitySeenByRole.set(task.role, Boolean(task.capabilities?.browser));

        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "frontend still shows old value",
            tldr: "browser path reproduced without browser tooling",
            likelyCause: "stale value",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "standard verification passed",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_browser_command_unavailable",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "web",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "browser",
              language: "typescript",
              framework: "next.js",
            },
            error: {
              message: "dashboard shows stale value",
            },
            context: {
              request: {
                url: "http://127.0.0.1:3000/dashboard",
              },
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
            browser: {
              enabled: true,
              command: "agent-browser",
              targetUrl: "http://127.0.0.1:3000/dashboard",
            },
          },
        },
        agentClient,
        {
          browserCommandAvailable: async () => false,
        }
      );

      expect(report.status).toBe("passed");
      expect(browserCapabilitySeenByRole.get("replicator")).toBe(false);
      expect(browserCapabilitySeenByRole.get("tester")).toBe(false);
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("recreates the artifacts directory before persisting tester results", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-orchestrator-artifacts-"));
    const artifactsDir = await mkdtemp(
      join(tmpdir(), "aurakeeper-orchestrator-artifacts-ui")
    );
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;

    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "value.txt still contains old",
            tldr: "value is stale",
            likelyCause: "constant was not updated",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        await rm(task.artifactsDir, { recursive: true, force: true });

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "targeted command passed after patch",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_artifacts_dir_recreated",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: { name: "fixture" },
            source: { runtime: "node", language: "javascript" },
            error: {
              message: "expected new value",
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
          },
        },
        agentClient
      );

      expect(report.status).toBe("passed");

      const testerResultPath = join(artifactsDir, "agent-result-tester.json");
      const testerResult = JSON.parse(await readFile(testerResultPath, "utf8")) as {
        output?: { status?: string };
        error?: string;
      };

      expect(testerResult.output?.status).toBe("passed");
      expect(testerResult.error).toBeUndefined();
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  test("does not advertise browser automation for api route errors", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-browser-api-route-"));
    const artifactsDir = await createArtifactsDir();
    const browserCapabilitySeenByRole = new Map<string, boolean>();
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;

    const agentClient: RepairAgentClient = {
      async run<TInput, TOutput>(
        task: AgentTask<TInput>
      ): Promise<AgentResult<TOutput>> {
        browserCapabilitySeenByRole.set(task.role, Boolean(task.capabilities?.browser));

        if (task.role === "replicator") {
          const output: ReplicatorAgentOutput = {
            status: "reproduced",
            handoff: "api route still shows old value",
            tldr: "api route reproduced without browser tooling",
            likelyCause: "stale value",
            reproductionCommands: ['test "$(cat value.txt)" = "new"'],
          };

          return { output: output as TOutput };
        }

        if (task.role === "worker") {
          const output: WorkerAgentOutput = {
            status: "patched",
            issueSummary: "replace stale value",
            suspectedRootCause: "value.txt contains the old value",
            filesChanged: ["value.txt"],
            locChanged: 1,
            patch,
          };

          return { output: output as TOutput };
        }

        const input = task.input as TesterAgentInput;
        const output: TesterAgentOutput = {
          status: input.verificationReport.status,
          prGate: input.verificationReport.prGate,
          originalIssueVerification: "standard verification passed",
          regressionSummary: "configured checks passed",
          commandsReviewed: input.verificationReport.commands.map((command) => command.id),
          skippedSuites: input.verificationReport.suitesSkipped,
          artifactsReviewed: [input.verificationReport.artifactsDir ?? ""],
          confidence: "high",
        };

        return { output: output as TOutput };
      },
    };

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");

      const report = await orchestrateRepair(
        {
          repairAttemptId: "attempt_browser_api_route",
          repository: {
            checkoutPath: sourcePath,
          },
          error: {
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "web",
            service: {
              name: "fixture",
            },
            source: {
              runtime: "browser",
              language: "typescript",
              framework: "next.js",
            },
            error: {
              message: "api route failed",
              details: {
                url: "http://127.0.0.1:3000/api/demo?fail=1",
              },
            },
            context: {
              request: {
                url: "http://127.0.0.1:3000/api/demo?fail=1",
                path: "/api/demo",
              },
            },
          },
          backend: "local",
          environment: "local",
          trustLevel: "trusted",
          promotionMode: "manual",
          dockerAvailable: false,
          suites: ["targeted"],
          artifactsDir,
          config: {
            profiles: ["generic"],
            commands: {
              targeted: ['test "$(cat value.txt)" = "new"'],
            },
            browser: {
              enabled: true,
              command: "agent-browser",
              targetUrl: "http://127.0.0.1:3000/api/demo?fail=1",
            },
          },
        },
        agentClient,
        {
          browserCommandAvailable: async () => true,
        }
      );

      expect(report.status).toBe("passed");
      expect(browserCapabilitySeenByRole.get("replicator")).toBe(false);
      expect(browserCapabilitySeenByRole.get("tester")).toBe(false);
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

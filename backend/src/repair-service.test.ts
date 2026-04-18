import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { createApp } from "./app";
import { db } from "./db";
import { repairArtifacts, repairAttempts, errorLogs, projects } from "./schema";
import { RepairCoordinator } from "./repair-service";
import type {
  AgentResult,
  AgentTask,
  RepairAgentClient,
  ReplicatorAgentOutput,
  TesterAgentInput,
  TesterAgentOutput,
  WorkerAgentOutput,
} from "./verification/orchestrator";

function createAgentClient(patch: string): RepairAgentClient {
  return {
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
}

async function waitFor<T>(check: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check();

    if (predicate(value)) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for asynchronous repair completion");
}

describe("repair coordination", () => {
  test("auto-triggers repair agents after accepting an error log", async () => {
    const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const projectId = `proj_repair_${suffix}`;
    const projectToken = `token_${suffix}`;
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-repair-auto-"));
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;
    const app = createApp({
      repairCoordinator: new RepairCoordinator({
        agentClient: createAgentClient(patch),
      }),
    });

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");
      await writeFile(
        join(sourcePath, ".aurakeeper.json"),
        JSON.stringify({
          profiles: ["generic"],
          execution: {
            preferredBackend: "local",
            environment: "local",
            trustLevel: "trusted",
          },
          commands: {
            targeted: ['test "$(cat value.txt)" = "new"'],
          },
        })
      );

      db.insert(projects)
        .values({
          id: projectId,
          name: "Repair Auto",
          token: projectToken,
          repairCheckoutPath: sourcePath,
          repairBackend: "local",
          repairEnvironment: "local",
          repairTrustLevel: "trusted",
          repairAutoTrigger: true,
          createdAt: new Date().toISOString(),
        })
        .run();

      const response = await app.handle(
        new Request("http://localhost:3000/v1/logs/errors", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Token": projectToken,
          },
          body: JSON.stringify({
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: { name: "fixture" },
            source: { runtime: "node", language: "javascript" },
            error: {
              message: "expected new value",
              stack: "Error: expected new value\n    at readValue (value.txt:1:1)",
            },
          }),
        })
      );

      expect(response.status).toBe(202);
      const accepted = await response.json() as { id: string };

      const attempts = await waitFor(
        async () => {
          const attemptsResponse = await app.handle(
            new Request(`http://localhost:3000/v1/logs/errors/${accepted.id}/repair-attempts`, {
              headers: {
                "X-API-Token": projectToken,
              },
            })
          );

          return attemptsResponse.json() as Promise<Array<{ id: string }>>;
        },
        (value) => value.length === 1
      );

      expect(attempts).toHaveLength(1);

      const logsResponse = await app.handle(
        new Request("http://localhost:3000/v1/logs/errors", {
          headers: {
            "X-API-Token": projectToken,
          },
        })
      );
      const logs = await logsResponse.json() as Array<{ id: string; state: string }>;
      const storedLog = logs.find((entry) => entry.id === accepted.id);

      expect(storedLog?.state).toBe("verify_succeeded");
    } finally {
      db.delete(repairArtifacts)
        .where(eq(repairArtifacts.projectId, projectId))
        .run();
      db.delete(repairAttempts)
        .where(eq(repairAttempts.projectId, projectId))
        .run();
      db.delete(errorLogs)
        .where(eq(errorLogs.projectId, projectId))
        .run();
      db.delete(projects)
        .where(eq(projects.id, projectId))
        .run();
      await rm(sourcePath, { recursive: true, force: true });
    }
  });

  test("allows manually triggering a repair attempt for an existing log", async () => {
    const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const projectId = `proj_manual_${suffix}`;
    const projectToken = `token_${suffix}`;
    const errorLogId = `log_manual_${suffix}`;
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-repair-manual-"));
    const patch = `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`;
    const app = createApp({
      repairCoordinator: new RepairCoordinator({
        agentClient: createAgentClient(patch),
      }),
    });

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");
      await writeFile(
        join(sourcePath, ".aurakeeper.json"),
        JSON.stringify({
          profiles: ["generic"],
          execution: {
            preferredBackend: "local",
            environment: "local",
            trustLevel: "trusted",
          },
          commands: {
            targeted: ['test "$(cat value.txt)" = "new"'],
          },
        })
      );

      db.insert(projects)
        .values({
          id: projectId,
          name: "Repair Manual",
          token: projectToken,
          repairCheckoutPath: sourcePath,
          repairBackend: "local",
          repairEnvironment: "local",
          repairTrustLevel: "trusted",
          repairAutoTrigger: false,
          createdAt: new Date().toISOString(),
        })
        .run();

      db.insert(errorLogs)
        .values({
          id: errorLogId,
          projectId,
          state: "new_error",
          eventId: null,
          occurredAt: "2026-04-18T08:32:17Z",
          receivedAt: "2026-04-18T08:32:18Z",
          level: "error",
          platform: "backend",
          environment: "local",
          serviceName: "fixture",
          serviceVersion: null,
          serviceInstanceId: null,
          sourceRuntime: "node",
          sourceLanguage: "javascript",
          sourceFramework: null,
          sourceComponent: null,
          errorType: "Error",
          errorMessage: "expected new value",
          errorCode: null,
          errorStack: "Error: expected new value\n    at readValue (value.txt:1:1)",
          errorHandled: false,
          errorDetails: null,
          context: null,
          rawPayload: JSON.stringify({
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: { name: "fixture" },
            source: { runtime: "node", language: "javascript" },
            error: {
              message: "expected new value",
              stack: "Error: expected new value\n    at readValue (value.txt:1:1)",
            },
          }),
          createdAt: "2026-04-18T08:32:18Z",
        })
        .run();

      const response = await app.handle(
        new Request(`http://localhost:3000/v1/logs/errors/${errorLogId}/repair-attempts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Token": projectToken,
          },
          body: JSON.stringify({
            issueSummary: "Fix the stale value regression",
          }),
        })
      );

      expect(response.status).toBe(202);
      const accepted = await response.json() as { status: string; state: string };

      expect(accepted.status).toBe("queued");
      expect(accepted.state).toBe("repro_started");

      const attempts = await waitFor(
        async () => {
          const attemptsResponse = await app.handle(
            new Request(`http://localhost:3000/v1/logs/errors/${errorLogId}/repair-attempts`, {
              headers: {
                "X-API-Token": projectToken,
              },
            })
          );

          return attemptsResponse.json() as Promise<Array<{ id: string }>>;
        },
        (value) => value.length === 1
      );

      expect(attempts).toHaveLength(1);
    } finally {
      db.delete(repairArtifacts)
        .where(eq(repairArtifacts.projectId, projectId))
        .run();
      db.delete(repairAttempts)
        .where(eq(repairAttempts.projectId, projectId))
        .run();
      db.delete(errorLogs)
        .where(eq(errorLogs.projectId, projectId))
        .run();
      db.delete(projects)
        .where(eq(projects.id, projectId))
        .run();
      await rm(sourcePath, { recursive: true, force: true });
    }
  });
});

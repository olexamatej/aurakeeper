import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { app } from "./app";
import { db } from "./db";
import { persistRepairArtifactsForErrorLog } from "./repair-artifacts";
import { errorLogs, projects, repairArtifacts, repairAttempts } from "./schema";
import type { RepairOrchestrationReport } from "./verification/orchestrator";

describe("repair artifact persistence", () => {
  test("links persisted artifacts to a specific error log and serves them over the API", async () => {
    const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const projectId = `proj_test_${suffix}`;
    const projectToken = `token_${suffix}`;
    const errorLogId = `log_test_${suffix}`;
    const sourceArtifactsDir = await mkdtemp(join(tmpdir(), "aurakeeper-repair-source-"));
    const artifactStoreRoot = await mkdtemp(join(tmpdir(), "aurakeeper-repair-store-"));

    try {
      db.insert(projects)
        .values({
          id: projectId,
          name: `Project ${suffix}`,
          token: projectToken,
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
          platform: "web",
          environment: "production",
          serviceName: "fixture",
          serviceVersion: "1.0.0",
          serviceInstanceId: null,
          sourceRuntime: "browser",
          sourceLanguage: "typescript",
          sourceFramework: "react",
          sourceComponent: "dashboard",
          errorType: "TypeError",
          errorMessage: "dashboard is broken",
          errorCode: null,
          errorStack: null,
          errorHandled: false,
          errorDetails: null,
          context: JSON.stringify({ request: { path: "/dashboard" } }),
          rawPayload: JSON.stringify({
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "web",
            service: { name: "fixture" },
            source: { runtime: "browser", language: "typescript" },
            error: { message: "dashboard is broken" },
          }),
          createdAt: "2026-04-18T08:32:18Z",
        })
        .run();

      await writeFile(join(sourceArtifactsDir, "replicator-browser-current.png"), "fakepng");
      await writeFile(
        join(sourceArtifactsDir, "orchestrator-report.json"),
        JSON.stringify({ ok: true }, null, 2)
      );

      const report: RepairOrchestrationReport = {
        repairAttemptId: `repair_test_${suffix}`,
        status: "passed",
        prGate: "allow",
        stage: "complete",
        selectedBackend: "local",
        backendReason: "Selected 'local' from orchestrator policy.",
        backendFallback: false,
        profileId: "generic",
        suitesRequested: ["targeted"],
        artifactsDir: sourceArtifactsDir,
        agents: {},
        startedAt: "2026-04-18T08:40:00Z",
        finishedAt: "2026-04-18T08:41:00Z",
      };

      const persisted = await persistRepairArtifactsForErrorLog({
        errorLogId,
        report,
        artifactStoreRoot,
      });

      expect(persisted.errorLogId).toBe(errorLogId);
      expect(persisted.artifacts.length).toBe(2);
      expect(persisted.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);

      const attemptsResponse = await app.handle(
        new Request(`http://localhost:3000/v1/logs/errors/${errorLogId}/repair-attempts`, {
          headers: {
            "X-API-Token": projectToken,
          },
        })
      );

      expect(attemptsResponse.status).toBe(200);
      const attempts = (await attemptsResponse.json()) as Array<{
        id: string;
        artifacts: Array<{ id: string; kind: string }>;
      }>;

      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.id).toBe(report.repairAttemptId);

      const screenshot = attempts[0]?.artifacts.find((artifact) => artifact.kind === "screenshot");
      expect(screenshot).toBeTruthy();

      const artifactResponse = await app.handle(
        new Request(
          `http://localhost:3000/v1/logs/errors/${errorLogId}/artifacts/${screenshot?.id}`,
          {
            headers: {
              "X-API-Token": projectToken,
            },
          }
        )
      );

      expect(artifactResponse.status).toBe(200);
      expect(artifactResponse.headers.get("content-type")).toBe("image/png");
      expect(await artifactResponse.text()).toBe("fakepng");
    } finally {
      db.delete(repairArtifacts).where(eq(repairArtifacts.errorLogId, errorLogId)).run();
      db.delete(repairAttempts).where(eq(repairAttempts.errorLogId, errorLogId)).run();
      db.delete(errorLogs).where(eq(errorLogs.id, errorLogId)).run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
      await rm(sourceArtifactsDir, { recursive: true, force: true });
      await rm(artifactStoreRoot, { recursive: true, force: true });
    }
  });
});

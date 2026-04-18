import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  test("applies a verified original patch on demand", async () => {
    const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const projectId = `proj_apply_${suffix}`;
    const projectToken = `token_${suffix}`;
    const errorLogId = `log_apply_${suffix}`;
    const repairAttemptId = `repair_apply_${suffix}`;
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-repair-source-"));
    const artifactsDir = await mkdtemp(join(tmpdir(), "aurakeeper-repair-artifacts-"));

    try {
      await writeFile(join(sourcePath, "value.txt"), "old\n");
      await writeFile(
        join(artifactsDir, "worker.original.patch"),
        `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-old
+new
`
      );

      db.insert(projects)
        .values({
          id: projectId,
          name: `Project ${suffix}`,
          token: projectToken,
          repairCheckoutPath: sourcePath,
          repairPromotionMode: "manual",
          createdAt: new Date().toISOString(),
        })
        .run();

      db.insert(errorLogs)
        .values({
          id: errorLogId,
          projectId,
          state: "verify_succeeded",
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
          errorStack: null,
          errorHandled: false,
          errorDetails: null,
          context: null,
          rawPayload: JSON.stringify({
            occurredAt: "2026-04-18T08:32:17Z",
            level: "error",
            platform: "backend",
            service: { name: "fixture" },
            source: { runtime: "node", language: "javascript" },
            error: { message: "expected new value" },
          }),
          createdAt: "2026-04-18T08:32:18Z",
        })
        .run();

      db.insert(repairAttempts)
        .values({
          id: repairAttemptId,
          errorLogId,
          projectId,
          status: "passed",
          prGate: "allow",
          stage: "complete",
          artifactsDir,
          targetCheckoutPath: sourcePath,
          promotionMode: "manual",
          sourcePatchStatus: "pending_manual",
          failureReason: null,
          startedAt: "2026-04-18T08:40:00Z",
          finishedAt: "2026-04-18T08:41:00Z",
          createdAt: "2026-04-18T08:41:00Z",
        })
        .run();

      const response = await app.handle(
        new Request(
          `http://localhost:3000/v1/logs/errors/${errorLogId}/repair-attempts/${repairAttemptId}/apply`,
          {
            method: "POST",
            headers: {
              "X-API-Token": projectToken,
            },
          }
        )
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { sourcePatchStatus: string };

      expect(body.sourcePatchStatus).toBe("applied");
      expect(await readFile(join(sourcePath, "value.txt"), "utf8")).toBe("new\n");
    } finally {
      db.delete(repairArtifacts).where(eq(repairArtifacts.errorLogId, errorLogId)).run();
      db.delete(repairAttempts).where(eq(repairAttempts.errorLogId, errorLogId)).run();
      db.delete(errorLogs).where(eq(errorLogs.id, errorLogId)).run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

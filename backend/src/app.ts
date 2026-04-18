import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { config } from "./config";
import { db, sqliteDb } from "./db";
import {
  errorGroups,
  errorLogs,
  projectConfigs,
  projects,
  repairAttempts,
} from "./schema";
import {
  ApiError,
  parseCreateProjectRequest,
  parseErrorLogRequest,
} from "./validation";
import {
  parseCollectorSelectionRequest,
  parseRepairJobClaimRequest,
  parseRepairJobCompleteRequest,
  parseProjectConfigRequest,
  selectCollector,
} from "./local";

function createLogId(): string {
  return `log_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createProjectId(): string {
  return `proj_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createProjectToken(): string {
  return `ak_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createErrorGroupId(): string {
  return `grp_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createRepairJobId(): string {
  return `job_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createRepairAttemptId(): string {
  return `att_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new ApiError(
      400,
      "invalid_request",
      "Request body must be valid JSON",
    );
  }
}

function requireAdminToken(request: Request): void {
  const adminToken = request.headers.get("x-admin-token");

  if (!adminToken || adminToken !== config.adminToken) {
    throw new ApiError(
      401,
      "unauthorized",
      "Admin token is missing or invalid",
    );
  }
}

function parseStoredJson(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeMessage(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function firstStackFrame(stack: string | undefined): string {
  if (!stack) {
    return "";
  }

  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => line.startsWith("at ")) ?? lines[1] ?? lines[0] ?? "";
}

function extractRequestPath(context: unknown): string {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    return "";
  }

  const request = (context as Record<string, unknown>).request;
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return "";
  }

  const path = (request as Record<string, unknown>).path;
  return typeof path === "string" ? path : "";
}

function createFingerprint(
  projectId: string,
  payload: ReturnType<typeof parseErrorLogRequest>,
): string {
  const parts = [
    projectId,
    payload.environment ?? "",
    payload.error.type ?? "",
    normalizeMessage(payload.error.message),
    firstStackFrame(payload.error.stack),
    extractRequestPath(payload.context),
    payload.source.component ?? "",
  ];

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function serializeProjectConfig(
  configRow: typeof projectConfigs.$inferSelect,
): Record<string, unknown> {
  const allowedRepairPaths = parseStoredJson(configRow.allowedRepairPaths);

  return {
    projectId: configRow.projectId,
    serviceName: configRow.serviceName,
    repoPath: configRow.repoPath,
    runtime: configRow.runtime,
    framework: configRow.framework ?? undefined,
    packageManager: configRow.packageManager ?? undefined,
    installCommand: configRow.installCommand ?? undefined,
    testCommand: configRow.testCommand ?? undefined,
    entrypointPath: configRow.entrypointPath ?? undefined,
    endpoint: configRow.endpoint ?? undefined,
    tokenEnvVar: configRow.tokenEnvVar ?? undefined,
    allowedRepairPaths: Array.isArray(allowedRepairPaths) ? allowedRepairPaths : [],
    updatedAt: configRow.updatedAt,
  };
}

function parseProjectIdQuery(request: Request): string {
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!projectId) {
    throw new ApiError(400, "invalid_request", "projectId query parameter is required");
  }

  return projectId;
}

function enqueueLocalRepair(projectId: string, logId: string, occurredAt: string, rawPayload: string): void {
  const payload = parseErrorLogRequest(JSON.parse(rawPayload));
  const fingerprint = createFingerprint(projectId, payload);
  const now = new Date().toISOString();

  sqliteDb.transaction(() => {
    const group = sqliteDb
      .query(
        "SELECT id, event_count, representative_log_id FROM error_groups WHERE project_id = ? AND fingerprint = ?",
      )
      .get(projectId, fingerprint) as
      | { id: string; event_count: number; representative_log_id: string }
      | null;

    let errorGroupId = group?.id;

    if (group) {
      sqliteDb
        .query(
          `UPDATE error_groups
           SET last_seen_at = ?, event_count = ?, last_log_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(occurredAt, Number(group.event_count) + 1, logId, now, group.id);
    } else {
      errorGroupId = createErrorGroupId();
      sqliteDb
        .query(
          `INSERT INTO error_groups (
            id, project_id, fingerprint, status, first_seen_at, last_seen_at,
            event_count, representative_log_id, last_log_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          errorGroupId,
          projectId,
          fingerprint,
          "open",
          occurredAt,
          occurredAt,
          1,
          logId,
          logId,
          now,
          now,
        );
    }

    if (!errorGroupId) {
      throw new ApiError(500, "internal_error", "Error group could not be determined");
    }

    const activeJob = sqliteDb
      .query(
        "SELECT id FROM repair_jobs WHERE error_group_id = ? AND status IN ('pending', 'claimed') LIMIT 1",
      )
      .get(errorGroupId) as { id: string } | null;

    if (!activeJob) {
      sqliteDb
        .query(
          `INSERT INTO repair_jobs (
            id, project_id, error_group_id, status, attempts, available_at,
            locked_at, worker_id, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(createRepairJobId(), projectId, errorGroupId, "pending", 0, now, now, now);
    }
  })();
}

function claimRepairJob(workerId: string): Record<string, unknown> | null {
  const now = new Date().toISOString();

  return sqliteDb.transaction(() => {
    const job = sqliteDb
      .query(
        `SELECT id, project_id, error_group_id, attempts, available_at, created_at
         FROM repair_jobs
         WHERE status = 'pending' AND available_at <= ?
         ORDER BY available_at ASC, created_at ASC
         LIMIT 1`,
      )
      .get(now) as
      | {
          id: string;
          project_id: string;
          error_group_id: string;
          attempts: number;
          available_at: string;
          created_at: string;
        }
      | null;

    if (!job) {
      return null;
    }

    const attemptId = createRepairAttemptId();

    sqliteDb
      .query(
        `UPDATE repair_jobs
         SET status = 'claimed', attempts = ?, locked_at = ?, worker_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(Number(job.attempts) + 1, now, workerId, now, job.id);

    sqliteDb
      .query(
        `INSERT INTO repair_attempts (
          id, job_id, project_id, error_group_id, status, worker_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(attemptId, job.id, job.project_id, job.error_group_id, "running", workerId, now, now);

    const projectConfig = db
      .select()
      .from(projectConfigs)
      .where(eq(projectConfigs.projectId, job.project_id))
      .get();

    const errorGroup = db
      .select()
      .from(errorGroups)
      .where(eq(errorGroups.id, job.error_group_id))
      .get();

    if (!projectConfig || !errorGroup) {
      throw new ApiError(409, "invalid_state", "Repair job is missing local project configuration");
    }

    const representativeLog = db
      .select()
      .from(errorLogs)
      .where(eq(errorLogs.id, errorGroup.representativeLogId))
      .get();

    if (!representativeLog) {
      throw new ApiError(409, "invalid_state", "Repair job is missing a representative error log");
    }

    return {
      job: {
        id: job.id,
        projectId: job.project_id,
        errorGroupId: job.error_group_id,
        attemptNumber: Number(job.attempts) + 1,
        status: "claimed",
        availableAt: job.available_at,
        claimedAt: now,
        workerId,
      },
      attempt: {
        id: attemptId,
        status: "running",
        workerId,
        createdAt: now,
      },
      projectConfig: serializeProjectConfig(projectConfig),
      errorGroup: {
        id: errorGroup.id,
        fingerprint: errorGroup.fingerprint,
        status: errorGroup.status,
        firstSeenAt: errorGroup.firstSeenAt,
        lastSeenAt: errorGroup.lastSeenAt,
        eventCount: errorGroup.eventCount,
        representativeLogId: errorGroup.representativeLogId,
        lastLogId: errorGroup.lastLogId,
      },
      representativeLog: {
        id: representativeLog.id,
        eventId: representativeLog.eventId,
        occurredAt: representativeLog.occurredAt,
        receivedAt: representativeLog.receivedAt,
        level: representativeLog.level,
        platform: representativeLog.platform,
        environment: representativeLog.environment,
        serviceName: representativeLog.serviceName,
        sourceRuntime: representativeLog.sourceRuntime,
        sourceLanguage: representativeLog.sourceLanguage,
        sourceFramework: representativeLog.sourceFramework,
        sourceComponent: representativeLog.sourceComponent,
        errorType: representativeLog.errorType,
        errorMessage: representativeLog.errorMessage,
        errorCode: representativeLog.errorCode,
        errorStack: representativeLog.errorStack,
        errorHandled: representativeLog.errorHandled,
        errorDetails: parseStoredJson(representativeLog.errorDetails),
        context: parseStoredJson(representativeLog.context),
        rawPayload: parseStoredJson(representativeLog.rawPayload),
      },
    };
  })();
}

function completeRepairJob(
  jobId: string,
  payload: ReturnType<typeof parseRepairJobCompleteRequest>,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const attempt = db
    .select()
    .from(repairAttempts)
    .where(eq(repairAttempts.id, payload.attemptId))
    .get();

  if (!attempt || attempt.jobId !== jobId) {
    throw new ApiError(404, "not_found", "Repair attempt was not found");
  }

  const nextJobStatus =
    payload.status === "patched"
      ? "completed"
      : payload.status === "needs_manual_review"
        ? "manual_review"
        : "failed";

  db.update(repairAttempts)
    .set({
      status: payload.status,
      replicatorHandoffPath: payload.replicatorHandoffPath,
      patchSummary: payload.patchSummary,
      verificationCommand: payload.verificationCommand,
      verificationExitCode: payload.verificationExitCode,
      verificationStdout: payload.verificationStdout,
      verificationStderr: payload.verificationStderr,
      confidence: payload.confidence,
      runDirectory: payload.runDirectory,
      resultPayload: payload.resultPayload ? JSON.stringify(payload.resultPayload) : null,
      updatedAt: now,
      completedAt: now,
    })
    .where(eq(repairAttempts.id, payload.attemptId))
    .run();

  sqliteDb
    .query(
      `UPDATE repair_jobs
       SET status = ?, updated_at = ?, last_error = ?, locked_at = NULL
       WHERE id = ?`,
    )
    .run(nextJobStatus, now, payload.failureReason ?? null, jobId);

  return {
    jobId,
    attemptId: payload.attemptId,
    status: payload.status,
    completedAt: now,
  };
}

function listErrorGroups(projectId: string): Record<string, unknown> {
  const items = db
    .select()
    .from(errorGroups)
    .where(eq(errorGroups.projectId, projectId))
    .all()
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .map((group) => ({
      id: group.id,
      projectId: group.projectId,
      fingerprint: group.fingerprint,
      status: group.status,
      firstSeenAt: group.firstSeenAt,
      lastSeenAt: group.lastSeenAt,
      eventCount: group.eventCount,
      representativeLogId: group.representativeLogId,
      lastLogId: group.lastLogId,
    }));

  return { items };
}

function listRepairAttempts(projectId: string): Record<string, unknown> {
  const items = db
    .select()
    .from(repairAttempts)
    .where(eq(repairAttempts.projectId, projectId))
    .all()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((attempt) => ({
      id: attempt.id,
      jobId: attempt.jobId,
      projectId: attempt.projectId,
      errorGroupId: attempt.errorGroupId,
      status: attempt.status,
      workerId: attempt.workerId,
      replicatorHandoffPath: attempt.replicatorHandoffPath,
      patchSummary: attempt.patchSummary,
      verificationCommand: attempt.verificationCommand,
      verificationExitCode: attempt.verificationExitCode,
      confidence: attempt.confidence,
      runDirectory: attempt.runDirectory,
      resultPayload: parseStoredJson(attempt.resultPayload),
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      completedAt: attempt.completedAt,
    }));

  return { items };
}

function projectStatus(projectId: string): Record<string, unknown> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  const projectConfig = db
    .select()
    .from(projectConfigs)
    .where(eq(projectConfigs.projectId, projectId))
    .get();

  if (!project || !projectConfig) {
    throw new ApiError(404, "not_found", "Project was not found");
  }

  const groups = db.select().from(errorGroups).where(eq(errorGroups.projectId, projectId)).all();
  const attempts = db
    .select()
    .from(repairAttempts)
    .where(eq(repairAttempts.projectId, projectId))
    .all();
  const jobCounts = sqliteDb
    .query(
      `SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN status = 'manual_review' THEN 1 ELSE 0 END) AS manual_review_count
      FROM repair_jobs
      WHERE project_id = ?`,
    )
    .get(projectId) as
    | {
        pending_count: number | null;
        claimed_count: number | null;
        completed_count: number | null;
        failed_count: number | null;
        manual_review_count: number | null;
      }
    | null;

  return {
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
    },
    projectConfig: serializeProjectConfig(projectConfig),
    queue: {
      pending: Number(jobCounts?.pending_count ?? 0),
      claimed: Number(jobCounts?.claimed_count ?? 0),
      completed: Number(jobCounts?.completed_count ?? 0),
      failed: Number(jobCounts?.failed_count ?? 0),
      manualReview: Number(jobCounts?.manual_review_count ?? 0),
    },
    errorGroups: {
      total: groups.length,
      open: groups.filter((group) => group.status === "open").length,
      latest: groups
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .slice(0, 5)
        .map((group) => ({
          id: group.id,
          status: group.status,
          lastSeenAt: group.lastSeenAt,
          eventCount: group.eventCount,
          representativeLogId: group.representativeLogId,
        })),
    },
    repairAttempts: {
      total: attempts.length,
      running: attempts.filter((attempt) => attempt.status === "running").length,
      patched: attempts.filter((attempt) => attempt.status === "patched").length,
      failed: attempts.filter((attempt) => attempt.status === "failed").length,
      manualReview: attempts.filter((attempt) => attempt.status === "needs_manual_review").length,
      latest: attempts
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 5)
        .map((attempt) => ({
          id: attempt.id,
          jobId: attempt.jobId,
          status: attempt.status,
          createdAt: attempt.createdAt,
          completedAt: attempt.completedAt,
          confidence: attempt.confidence,
        })),
    },
  };
}

export const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.status;

      return {
        error: error.code,
        message: error.message,
      };
    }

    console.error(error);
    set.status = 500;

    return {
      error: "internal_error",
      message: "Unexpected server error",
    };
  })
  .get("/", () => "OK")
  .post("/v1/projects", async ({ request, set }) => {
    requireAdminToken(request);

    const payload = parseCreateProjectRequest(await parseJsonBody(request));
    const createdAt = new Date().toISOString();
    const id = createProjectId();
    const token = createProjectToken();

    db.insert(projects)
      .values({
        id,
        name: payload.name,
        token,
        createdAt,
      })
      .run();

    set.status = 201;

    return {
      id,
      name: payload.name,
      token,
      createdAt,
    };
  })
  .post("/v1/local/collector-selection", async ({ request }) => {
    requireAdminToken(request);

    const payload = parseCollectorSelectionRequest(await parseJsonBody(request));
    return selectCollector(payload);
  })
  .put("/v1/local/projects/:projectId/config", async ({ request, params, set }) => {
    requireAdminToken(request);

    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .get();

    if (!project) {
      throw new ApiError(404, "not_found", "Project was not found");
    }

    const payload = parseProjectConfigRequest(await parseJsonBody(request));
    const now = new Date().toISOString();
    const existingConfig = db
      .select()
      .from(projectConfigs)
      .where(eq(projectConfigs.projectId, params.projectId))
      .get();

    if (existingConfig) {
      db.update(projectConfigs)
        .set({
          serviceName: payload.serviceName,
          repoPath: payload.repoPath,
          runtime: payload.runtime,
          framework: payload.framework,
          packageManager: payload.packageManager,
          installCommand: payload.installCommand,
          testCommand: payload.testCommand,
          entrypointPath: payload.entrypointPath,
          endpoint: payload.endpoint,
          tokenEnvVar: payload.tokenEnvVar,
          allowedRepairPaths: JSON.stringify(payload.allowedRepairPaths),
          updatedAt: now,
        })
        .where(eq(projectConfigs.projectId, params.projectId))
        .run();
    } else {
      db.insert(projectConfigs)
        .values({
          projectId: params.projectId,
          serviceName: payload.serviceName,
          repoPath: payload.repoPath,
          runtime: payload.runtime,
          framework: payload.framework,
          packageManager: payload.packageManager,
          installCommand: payload.installCommand,
          testCommand: payload.testCommand,
          entrypointPath: payload.entrypointPath,
          endpoint: payload.endpoint,
          tokenEnvVar: payload.tokenEnvVar,
          allowedRepairPaths: JSON.stringify(payload.allowedRepairPaths),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    set.status = existingConfig ? 200 : 201;

    return {
      projectId: params.projectId,
      serviceName: payload.serviceName,
      repoPath: payload.repoPath,
      runtime: payload.runtime,
      framework: payload.framework,
      packageManager: payload.packageManager,
      installCommand: payload.installCommand,
      testCommand: payload.testCommand,
      entrypointPath: payload.entrypointPath,
      endpoint: payload.endpoint,
      tokenEnvVar: payload.tokenEnvVar,
      allowedRepairPaths: payload.allowedRepairPaths,
      updatedAt: now,
    };
  })
  .get("/v1/local/projects/:projectId/status", async ({ request, params }) => {
    requireAdminToken(request);
    return projectStatus(params.projectId);
  })
  .get("/v1/local/error-groups", async ({ request }) => {
    requireAdminToken(request);
    return listErrorGroups(parseProjectIdQuery(request));
  })
  .get("/v1/local/repair-attempts", async ({ request }) => {
    requireAdminToken(request);
    return listRepairAttempts(parseProjectIdQuery(request));
  })
  .post("/v1/local/repair-jobs/claim", async ({ request }) => {
    requireAdminToken(request);
    const payload = parseRepairJobClaimRequest(await parseJsonBody(request));
    return claimRepairJob(payload.workerId) ?? { job: null };
  })
  .post("/v1/local/repair-jobs/:jobId/complete", async ({ request, params }) => {
    requireAdminToken(request);
    const payload = parseRepairJobCompleteRequest(await parseJsonBody(request));
    return completeRepairJob(params.jobId, payload);
  })
  .post("/v1/logs/errors", async ({ request, set }) => {
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      throw new ApiError(
        401,
        "unauthorized",
        "API token is missing or invalid",
      );
    }

    const project = db
      .select()
      .from(projects)
      .where(eq(projects.token, apiToken))
      .get();

    if (!project) {
      throw new ApiError(
        401,
        "unauthorized",
        "API token is missing or invalid",
      );
    }

    const payload = parseErrorLogRequest(await parseJsonBody(request));
    const receivedAt = new Date().toISOString();
    const id = createLogId();

    db.insert(errorLogs)
      .values({
        id,
        projectId: project.id,
        eventId: payload.eventId,
        occurredAt: payload.occurredAt,
        receivedAt,
        level: payload.level,
        platform: payload.platform,
        environment: payload.environment,
        serviceName: payload.service.name,
        serviceVersion: payload.service.version,
        serviceInstanceId: payload.service.instanceId,
        sourceRuntime: payload.source.runtime,
        sourceLanguage: payload.source.language,
        sourceFramework: payload.source.framework,
        sourceComponent: payload.source.component,
        errorType: payload.error.type,
        errorMessage: payload.error.message,
        errorCode: payload.error.code,
        errorStack: payload.error.stack,
        errorHandled: payload.error.handled,
        errorDetails: payload.error.details
          ? JSON.stringify(payload.error.details)
          : null,
        context: payload.context ? JSON.stringify(payload.context) : null,
        rawPayload: JSON.stringify(payload),
        createdAt: receivedAt,
      })
      .run();

    enqueueLocalRepair(project.id, id, payload.occurredAt, JSON.stringify(payload));

    set.status = 202;

    return {
      id,
      status: "accepted" as const,
      receivedAt,
    };
  });

import { Elysia } from "elysia";
import { desc, eq } from "drizzle-orm";

import { config } from "./config";
import { db } from "./db";
import { getExampleRun, listExamples, startExampleRun } from "./examples";
import { errorLogs, projects } from "./schema";
import {
  repairCoordinator as defaultRepairCoordinator,
  requireProjectRepairTarget,
  shouldAutoTriggerRepair,
  type RepairCoordinator,
} from "./repair-service";
import {
  applyStoredRepairAttemptPatch,
  listRepairAttemptsForErrorLog,
  readRepairArtifactContent,
} from "./repair-artifacts";
import { openapi } from "@elysiajs/openapi";
import { insertErrorLog, serializeErrorLog } from "./error-logs";
import { createSentrySource, pollSentrySource } from "./sentry";
import {
  ApiError,
  parseCreateRepairAttemptRequest,
  parseCreateProjectRequest,
  parseCreateSentrySourceRequest,
  parseErrorLogRequest,
  parseUpdateProjectRequest,
} from "./validation";

const DEFAULT_ALLOWED_HEADERS =
  "Content-Type, Authorization, X-Admin-Token, X-API-Token";
const DEFAULT_ALLOWED_METHODS = "GET, POST, OPTIONS";

function getAllowedOrigin(origin: string | null): string | null {
  if (!origin) {
    return null;
  }

  if (config.corsAllowedOrigins.includes("*")) {
    return "*";
  }

  return config.corsAllowedOrigins.includes(origin) ? origin : null;
}

function applyCorsHeaders(request: Request, headers: Record<string, string>) {
  const allowedOrigin = getAllowedOrigin(request.headers.get("origin"));

  if (!allowedOrigin) {
    return false;
  }

  headers["access-control-allow-origin"] = allowedOrigin;
  headers["access-control-allow-methods"] = DEFAULT_ALLOWED_METHODS;
  headers["access-control-allow-headers"] =
    request.headers.get("access-control-request-headers") ??
    DEFAULT_ALLOWED_HEADERS;
  headers["access-control-max-age"] = "86400";
  headers.vary = "Origin";

  return true;
}

function createProjectId(): string {
  return `proj_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createProjectToken(): string {
  return `ak_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
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

async function parseOptionalJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (rawBody.trim().length === 0) {
    return {};
  }

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

function serializeProject(project: typeof projects.$inferSelect) {
  return {
    id: project.id,
    name: project.name,
    token: project.token,
    repair: project.repairCheckoutPath
        ? {
          checkoutPath: project.repairCheckoutPath,
          repositoryUrl: project.repairRepositoryUrl ?? undefined,
          baseCommit: project.repairBaseCommit ?? undefined,
          backend: project.repairBackend ?? undefined,
          environment: project.repairEnvironment ?? undefined,
          trustLevel: project.repairTrustLevel ?? undefined,
          promotionMode: (project.repairPromotionMode ?? "auto") as "auto" | "manual",
          autoTrigger: project.repairAutoTrigger,
        }
      : undefined,
    createdAt: project.createdAt,
  };
}

function getApiTokenFromAuthorizationHeader(authorization: string | null): string | null {
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return null;
  }

  const token = match[1]?.trim();

  return token && token.length > 0 ? token : null;
}

function getProjectApiToken(request: Request): string | null {
  const apiToken = request.headers.get("x-api-token");

  if (apiToken && apiToken.trim().length > 0) {
    return apiToken.trim();
  }

  return getApiTokenFromAuthorizationHeader(request.headers.get("authorization"));
}

function requireProjectByApiToken(apiToken: string | null) {
  if (!apiToken) {
    throw new ApiError(401, "unauthorized", "API token is missing or invalid");
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.token, apiToken))
    .get();

  if (!project) {
    throw new ApiError(401, "unauthorized", "API token is missing or invalid");
  }

  return project;
}

function requireAdminToken(adminToken: string | null) {
  if (!adminToken || adminToken !== config.adminToken) {
    throw new ApiError(
      401,
      "unauthorized",
      "Admin token is missing or invalid",
    );
  }
}

function parseExampleRunRequest(value: unknown): {
  apiToken: string;
  endpoint?: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "invalid_request", "body must be an object");
  }

  const body = value as Record<string, unknown>;
  const unknownKey = Object.keys(body).find(
    (key) => key !== "apiToken" && key !== "endpoint",
  );

  if (unknownKey) {
    throw new ApiError(
      400,
      "invalid_request",
      `body contains unsupported field: ${unknownKey}`,
    );
  }

  if (typeof body.apiToken !== "string" || body.apiToken.length === 0) {
    throw new ApiError(400, "invalid_request", "apiToken must be a non-empty string");
  }

  if (body.endpoint !== undefined && typeof body.endpoint !== "string") {
    throw new ApiError(400, "invalid_request", "endpoint must be a string");
  }

  return {
    apiToken: body.apiToken,
    endpoint: body.endpoint,
  };
}

function requireErrorLogForProject(projectId: string, errorLogId: string) {
  const errorLog = db
    .select()
    .from(errorLogs)
    .where(eq(errorLogs.id, errorLogId))
    .get();

  if (!errorLog || errorLog.projectId !== projectId) {
    throw new ApiError(404, "not_found", "Error log not found");
  }

  return errorLog;
}

function requireProjectById(projectId: string) {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    throw new ApiError(404, "not_found", "Project not found");
  }

  return project;
}
export function createApp(options: { repairCoordinator?: RepairCoordinator } = {}) {
  const repairCoordinator = options.repairCoordinator ?? defaultRepairCoordinator;

  return new Elysia()
  .onRequest(({ request, set }) => {
    const corsHeaders: Record<string, string> = {};
    const origin = request.headers.get("origin");
    const corsAllowed = applyCorsHeaders(request, corsHeaders);

    Object.assign(set.headers, corsHeaders);

    if (request.method !== "OPTIONS") {
      return;
    }

    if (origin && !corsAllowed) {
      set.status = 403;

      return {
        error: "forbidden",
        message: "Origin is not allowed",
      };
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  })
  .onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;

      return {
        error: "not_found",
        message: "Route not found",
      };
    }

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
  .use(openapi())
  .get("/", () => ({
    status: "ok",
    docs: "/openapi",
  }))
  .get("/health", () => ({
    status: "ok",
  }))
  .post("/v1/projects", async ({ request, set }) => {
    requireAdminToken(request.headers.get("x-admin-token"));

    const payload = parseCreateProjectRequest(await parseJsonBody(request));
    const createdAt = new Date().toISOString();
    const id = createProjectId();
    const token = createProjectToken();

    db.insert(projects)
      .values({
        id,
        name: payload.name,
        token,
        repairCheckoutPath: payload.repair?.checkoutPath ?? null,
        repairRepositoryUrl: payload.repair?.repositoryUrl ?? null,
        repairBaseCommit: payload.repair?.baseCommit ?? null,
        repairBackend: payload.repair?.backend ?? null,
        repairEnvironment: payload.repair?.environment ?? null,
        repairTrustLevel: payload.repair?.trustLevel ?? null,
        repairPromotionMode: payload.repair?.promotionMode ?? "auto",
        repairAutoTrigger: payload.repair?.autoTrigger ?? false,
        createdAt,
      })
      .run();

    set.status = 201;

    const project = db.select().from(projects).where(eq(projects.id, id)).get();

    if (!project) {
      throw new ApiError(500, "internal_error", "Failed to create project");
    }

    return serializeProject(project);
  })
  .patch("/v1/projects/:projectId", async ({ params, request }) => {
    requireAdminToken(request.headers.get("x-admin-token"));
    const project = requireProjectById(params.projectId);
    const payload = parseUpdateProjectRequest(await parseJsonBody(request));

    db.update(projects)
      .set({
        name: payload.name ?? project.name,
        repairCheckoutPath:
          payload.repair === undefined
            ? project.repairCheckoutPath
            : payload.repair === null
              ? null
              : payload.repair.checkoutPath,
        repairRepositoryUrl:
          payload.repair === undefined
            ? project.repairRepositoryUrl
            : payload.repair === null
              ? null
              : payload.repair.repositoryUrl ?? null,
        repairBaseCommit:
          payload.repair === undefined
            ? project.repairBaseCommit
            : payload.repair === null
              ? null
              : payload.repair.baseCommit ?? null,
        repairBackend:
          payload.repair === undefined
            ? project.repairBackend
            : payload.repair === null
              ? null
              : payload.repair.backend ?? null,
        repairEnvironment:
          payload.repair === undefined
            ? project.repairEnvironment
            : payload.repair === null
              ? null
              : payload.repair.environment ?? null,
        repairTrustLevel:
          payload.repair === undefined
            ? project.repairTrustLevel
            : payload.repair === null
              ? null
              : payload.repair.trustLevel ?? null,
        repairPromotionMode:
          payload.repair === undefined
            ? project.repairPromotionMode
            : payload.repair === null
              ? "auto"
              : payload.repair.promotionMode ?? "auto",
        repairAutoTrigger:
          payload.repair === undefined
            ? project.repairAutoTrigger
            : payload.repair === null
              ? false
              : payload.repair.autoTrigger ?? false,
      })
      .where(eq(projects.id, project.id))
      .run();

    return serializeProject(requireProjectById(project.id));
  })
  .get("/v1/examples", async ({ request }) => {
    requireAdminToken(request.headers.get("x-admin-token"));

    return listExamples();
  })
  .post("/v1/examples/:exampleId/runs", async ({ params, request, set }) => {
    requireAdminToken(request.headers.get("x-admin-token"));

    const payload = parseExampleRunRequest(await parseJsonBody(request));
    const run = await startExampleRun({
      exampleId: params.exampleId,
      apiToken: payload.apiToken,
      endpoint: payload.endpoint,
    }).catch((error) => {
      throw new ApiError(404, "not_found", (error as Error).message);
    });

    set.status = 202;

    return run;
  })
  .get("/v1/examples/runs/:runId", ({ params, request }) => {
    requireAdminToken(request.headers.get("x-admin-token"));

    const run = getExampleRun(params.runId);

    if (!run) {
      throw new ApiError(404, "not_found", "Example run not found");
    }

    return run;
  })
  .get("/v1/logs/errors", ({ request }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));

    return db
      .select()
      .from(errorLogs)
      .where(eq(errorLogs.projectId, project.id))
      .orderBy(desc(errorLogs.createdAt))
      .all()
      .map(serializeErrorLog);
  })
  .post("/v1/logs/errors", async ({ request, set }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));
    const payload = parseErrorLogRequest(await parseJsonBody(request));
    const accepted = insertErrorLog(project.id, payload);

    if (shouldAutoTriggerRepair(project)) {
      const errorLog = requireErrorLogForProject(project.id, accepted.id);
      repairCoordinator.startRepair(project, errorLog);
    }

    set.status = 202;
    return accepted;
  })
  .post("/v1/sources/sentry", async ({ request, set }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));
    const payload = parseCreateSentrySourceRequest(await parseJsonBody(request));

    set.status = 201;

    return createSentrySource(project.id, payload);
  })
  .post("/v1/sources/sentry/:sourceId/poll", async ({ request, params }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));

    return pollSentrySource(project, params.sourceId, {
      onImportedErrorLog(errorLog) {
        if (shouldAutoTriggerRepair(project)) {
          repairCoordinator.startRepair(project, errorLog);
        }
      },
    });
  })
  .post("/v1/logs/errors/:logId/repair-attempts", async ({ request, params, set }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));
    requireProjectRepairTarget(project);
    const errorLog = requireErrorLogForProject(project.id, params.logId);
    const payload = parseCreateRepairAttemptRequest(await parseOptionalJsonBody(request));

    set.status = 202;

    return repairCoordinator.startRepair(project, errorLog, {
      issueSummary: payload.issueSummary,
    });
  })
  .get("/v1/logs/errors/:logId/repair-status", ({ request, params }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));
    requireErrorLogForProject(project.id, params.logId);

    const activeStatus = repairCoordinator.getActiveStatus(params.logId);

    return activeStatus ?? {
      running: false,
      logId: params.logId,
    };
  })
  .get("/v1/logs/errors/:logId/repair-attempts", ({ request, params }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));
    requireErrorLogForProject(project.id, params.logId);

    return listRepairAttemptsForErrorLog(project.id, params.logId);
  })
  .post(
    "/v1/logs/errors/:logId/repair-attempts/:repairAttemptId/apply",
    async ({ request, params }) => {
      const project = requireProjectByApiToken(request.headers.get("x-api-token"));
      requireErrorLogForProject(project.id, params.logId);

      return applyStoredRepairAttemptPatch({
        projectId: project.id,
        errorLogId: params.logId,
        repairAttemptId: params.repairAttemptId,
      }).catch((error) => {
        throw new ApiError(409, "repair_apply_failed", (error as Error).message);
      });
    }
  )
  .get("/v1/logs/errors/:logId/artifacts/:artifactId", async ({ request, params, set }) => {
    const project = requireProjectByApiToken(getProjectApiToken(request));
    requireErrorLogForProject(project.id, params.logId);

    const artifact = await readRepairArtifactContent(project.id, params.logId, params.artifactId);

    if (!artifact) {
      throw new ApiError(404, "not_found", "Artifact not found");
    }

    set.headers["Content-Type"] = artifact.contentType;
    set.headers["Content-Disposition"] = `inline; filename="${artifact.fileName}"`;

    return new Response(Buffer.from(artifact.content), {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Disposition": `inline; filename="${artifact.fileName}"`,
      },
    });
  });
}

export const app = createApp();

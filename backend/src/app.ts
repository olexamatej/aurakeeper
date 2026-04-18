import { Elysia } from "elysia";
import { desc, eq } from "drizzle-orm";

import { config } from "./config";
import { db } from "./db";
import { errorLogs, projects } from "./schema";
import {
  listRepairAttemptsForErrorLog,
  readRepairArtifactContent,
} from "./repair-artifacts";
import { openapi } from "@elysiajs/openapi";
import { insertErrorLog, serializeErrorLog } from "./error-logs";
import { createSentrySource, pollSentrySource } from "./sentry";
import {
  ApiError,
  parseCreateProjectRequest,
  parseCreateSentrySourceRequest,
  parseErrorLogRequest,
} from "./validation";

const DEFAULT_ALLOWED_HEADERS = "Content-Type, X-Admin-Token, X-API-Token";
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
export const app = new Elysia()
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
    const adminToken = request.headers.get("x-admin-token");

    if (!adminToken || adminToken !== config.adminToken) {
      throw new ApiError(
        401,
        "unauthorized",
        "Admin token is missing or invalid",
      );
    }

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
  .get("/v1/logs/errors", ({ request }) => {
    const project = requireProjectByApiToken(request.headers.get("x-api-token"));

    return db
      .select()
      .from(errorLogs)
      .where(eq(errorLogs.projectId, project.id))
      .orderBy(desc(errorLogs.createdAt))
      .all()
      .map(serializeErrorLog);
  })
  .post("/v1/logs/errors", async ({ request, set }) => {
    const project = requireProjectByApiToken(request.headers.get("x-api-token"));
    const payload = parseErrorLogRequest(await parseJsonBody(request));
    set.status = 202;
    return insertErrorLog(project.id, payload);
  })
  .post("/v1/sources/sentry", async ({ request, set }) => {
    const project = requireProjectByApiToken(request.headers.get("x-api-token"));
    const payload = parseCreateSentrySourceRequest(await parseJsonBody(request));

    set.status = 201;

    return createSentrySource(project.id, payload);
  })
  .post("/v1/sources/sentry/:sourceId/poll", async ({ request, params }) => {
    const project = requireProjectByApiToken(request.headers.get("x-api-token"));

    return pollSentrySource(project.id, params.sourceId);
  })
  .get("/v1/logs/errors/:logId/repair-attempts", ({ request, params }) => {
    const project = requireProjectByApiToken(request.headers.get("x-api-token"));
    requireErrorLogForProject(project.id, params.logId);

    return listRepairAttemptsForErrorLog(project.id, params.logId);
  })
  .get("/v1/logs/errors/:logId/artifacts/:artifactId", async ({ request, params, set }) => {
    const project = requireProjectByApiToken(request.headers.get("x-api-token"));
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

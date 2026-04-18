import { Elysia } from "elysia";
import { desc, eq } from "drizzle-orm";

import { config } from "./config";
import { db } from "./db";
import { errorLogs, projects } from "./schema";
import { openapi } from "@elysiajs/openapi";
import { insertErrorLog, serializeErrorLog } from "./error-logs";
import { createSentrySource, pollSentrySource } from "./sentry";
import {
  ApiError,
  parseCreateProjectRequest,
  parseCreateSentrySourceRequest,
  parseErrorLogRequest,
} from "./validation";

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

export const app = new Elysia()
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
  });

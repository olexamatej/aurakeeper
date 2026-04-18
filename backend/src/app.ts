import { Elysia } from "elysia";
import { desc, eq } from "drizzle-orm";

import { config } from "./config";
import { db } from "./db";
import { getExampleRun, listExamples, startExampleRun } from "./examples";
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

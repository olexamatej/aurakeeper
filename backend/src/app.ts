import { Elysia } from "elysia";
import { eq } from "drizzle-orm";

import { config } from "./config";
import { db } from "./db";
import { errorLogs, projects } from "./schema";
import { openapi } from "@elysiajs/openapi";
import {
  ApiError,
  parseCreateProjectRequest,
  parseErrorLogRequest,
} from "./validation";

function createLogId(): string {
  return `log_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
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
  .use(openapi())
  .get("/", () => "OK")
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

    set.status = 202;

    return {
      id,
      status: "accepted" as const,
      receivedAt,
    };
  });

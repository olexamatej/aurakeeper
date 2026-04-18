import { and, eq } from "drizzle-orm";

import { db } from "./db";
import { hasStoredEvent, insertErrorLog } from "./error-logs";
import {
  SentryClientError,
  fetchSentryProjectEvents,
  mapSentryEventToErrorLogRequest,
  type SentrySourceConfig,
} from "./sentry-client";
import { sentrySources } from "./schema";
import { ApiError, type CreateSentrySourceRequest } from "./validation";

function createSentrySourceId(): string {
  return `sentrysrc_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

type SentrySourceRow = typeof sentrySources.$inferSelect;

export function createSentrySource(
  projectId: string,
  payload: CreateSentrySourceRequest
) {
  const now = new Date().toISOString();
  const id = createSentrySourceId();

  db.insert(sentrySources)
    .values({
      id,
      projectId,
      organizationSlug: payload.organizationSlug,
      sentryProjectSlug: payload.projectSlug,
      baseUrl: normalizeBaseUrl(payload.baseUrl),
      authToken: payload.authToken,
      environment: payload.environment,
      maxEventsPerPoll: payload.maxEventsPerPoll ?? 100,
      serviceName: payload.service?.name,
      serviceVersion: payload.service?.version,
      serviceInstanceId: payload.service?.instanceId,
      sourceRuntime: payload.source?.runtime,
      sourceLanguage: payload.source?.language,
      sourceFramework: payload.source?.framework,
      sourceComponent: payload.source?.component,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db
    .select()
    .from(sentrySources)
    .where(eq(sentrySources.id, id))
    .get();

  if (!row) {
    throw new ApiError(500, "internal_error", "Failed to store Sentry source");
  }

  return serializeSentrySource(row);
}

export async function pollSentrySource(
  projectId: string,
  sourceId: string,
  options?: {
    fetchImpl?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  }
) {
  const row = requireSentrySource(projectId, sourceId);
  const startedAt = new Date().toISOString();

  try {
    const sourceConfig = toSentrySourceConfig(row);
    const rawEvents = await fetchSentryProjectEvents(sourceConfig, {
      start: row.lastPolledAt ?? undefined,
      end: startedAt,
      fetchImpl: options?.fetchImpl,
    });

    let importedCount = 0;
    let duplicateCount = 0;
    let filteredCount = 0;

    const orderedEvents = rawEvents
      .slice()
      .sort((left, right) =>
        String(left.dateCreated ?? "").localeCompare(String(right.dateCreated ?? ""))
      );

    for (const event of orderedEvents) {
      const payload = mapSentryEventToErrorLogRequest(event, sourceConfig);

      if (row.environment && payload.environment !== row.environment) {
        filteredCount += 1;
        continue;
      }

      if (payload.eventId && hasStoredEvent(projectId, payload.eventId)) {
        duplicateCount += 1;
        continue;
      }

      insertErrorLog(projectId, payload);
      importedCount += 1;
    }

    db.update(sentrySources)
      .set({
        lastPolledAt: startedAt,
        lastPollError: null,
        updatedAt: startedAt,
      })
      .where(eq(sentrySources.id, row.id))
      .run();

    return {
      sourceId: row.id,
      status: "completed" as const,
      fetchedCount: rawEvents.length,
      importedCount,
      duplicateCount,
      filteredCount,
      lastPolledAt: startedAt,
    };
  } catch (error) {
    const message = toPollErrorMessage(error);

    db.update(sentrySources)
      .set({
        lastPollError: message,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sentrySources.id, row.id))
      .run();

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(502, "upstream_error", message);
  }
}

function requireSentrySource(projectId: string, sourceId: string): SentrySourceRow {
  const row = db
    .select()
    .from(sentrySources)
    .where(and(eq(sentrySources.id, sourceId), eq(sentrySources.projectId, projectId)))
    .get();

  if (!row) {
    throw new ApiError(404, "not_found", "Sentry source not found");
  }

  return row;
}

function serializeSentrySource(row: SentrySourceRow) {
  return {
    id: row.id,
    organizationSlug: row.organizationSlug,
    projectSlug: row.sentryProjectSlug,
    baseUrl: row.baseUrl,
    environment: row.environment ?? undefined,
    maxEventsPerPoll: row.maxEventsPerPoll,
    service:
      row.serviceName || row.serviceVersion || row.serviceInstanceId
        ? {
            name: row.serviceName ?? undefined,
            version: row.serviceVersion ?? undefined,
            instanceId: row.serviceInstanceId ?? undefined,
          }
        : undefined,
    source:
      row.sourceRuntime ||
      row.sourceLanguage ||
      row.sourceFramework ||
      row.sourceComponent
        ? {
            runtime: row.sourceRuntime ?? undefined,
            language: row.sourceLanguage ?? undefined,
            framework: row.sourceFramework ?? undefined,
            component: row.sourceComponent ?? undefined,
          }
        : undefined,
    lastPolledAt: row.lastPolledAt ?? undefined,
    lastPollError: row.lastPollError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const normalized = new URL(baseUrl ?? "https://sentry.io");

  normalized.pathname = normalized.pathname.replace(/\/+$/, "");

  return normalized.toString().replace(/\/+$/, "");
}

function toSentrySourceConfig(row: SentrySourceRow): SentrySourceConfig {
  return {
    organizationSlug: row.organizationSlug,
    projectSlug: row.sentryProjectSlug,
    authToken: row.authToken,
    baseUrl: row.baseUrl,
    environment: row.environment ?? undefined,
    maxEventsPerPoll: row.maxEventsPerPoll,
    serviceName: row.serviceName,
    serviceVersion: row.serviceVersion,
    serviceInstanceId: row.serviceInstanceId,
    sourceRuntime: row.sourceRuntime,
    sourceLanguage: row.sourceLanguage,
    sourceFramework: row.sourceFramework,
    sourceComponent: row.sourceComponent,
  };
}

function toPollErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof SentryClientError) {
    if (error.status === 401 || error.status === 403) {
      return "Sentry rejected the request. Check the auth token and project scope.";
    }

    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Failed to poll Sentry";
}

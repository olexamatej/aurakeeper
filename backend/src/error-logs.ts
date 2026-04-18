import { and, eq } from "drizzle-orm";

import { db } from "./db";
import { errorLogs } from "./schema";
import type { ErrorLogRequest, IssueState } from "./validation";

export function createLogId(): string {
  return `log_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function hasStoredEvent(projectId: string, eventId: string): boolean {
  const row = db
    .select({ id: errorLogs.id })
    .from(errorLogs)
    .where(and(eq(errorLogs.projectId, projectId), eq(errorLogs.eventId, eventId)))
    .get();

  return row !== null && row !== undefined;
}

export function insertErrorLog(
  projectId: string,
  payload: ErrorLogRequest,
  options?: {
    receivedAt?: string;
    state?: IssueState;
  }
) {
  const receivedAt = options?.receivedAt ?? new Date().toISOString();
  const state = options?.state ?? "new_error";
  const id = createLogId();

  db.insert(errorLogs)
    .values({
      id,
      projectId,
      state,
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
      errorDetails: payload.error.details ? JSON.stringify(payload.error.details) : null,
      context: payload.context ? JSON.stringify(payload.context) : null,
      rawPayload: JSON.stringify(payload),
      createdAt: receivedAt,
    })
    .run();

  return {
    id,
    state,
    status: "accepted" as const,
    receivedAt,
  };
}

export function serializeErrorLog(row: typeof errorLogs.$inferSelect) {
  const payload = parseStoredErrorLogPayload(row);

  return {
    id: row.id,
    state: row.state as IssueState,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    ...(payload ?? {}),
  };
}

export function parseStoredErrorLogPayload(
  row: Pick<typeof errorLogs.$inferSelect, "rawPayload">
): ReturnType<typeof JSON.parse> | null {
  try {
    return JSON.parse(row.rawPayload);
  } catch {
    return null;
  }
}

export function updateErrorLogState(errorLogId: string, state: IssueState): void {
  db.update(errorLogs)
    .set({ state })
    .where(eq(errorLogs.id, errorLogId))
    .run();
}

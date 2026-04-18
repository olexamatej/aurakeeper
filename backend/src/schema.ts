import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    token: text("token").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    nameIdx: index("projects_name_idx").on(table.name),
    tokenIdx: index("projects_token_idx").on(table.token),
  })
);

export const errorLogs = sqliteTable(
  "error_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    eventId: text("event_id"),
    occurredAt: text("occurred_at").notNull(),
    receivedAt: text("received_at").notNull(),
    level: text("level").notNull(),
    platform: text("platform").notNull(),
    environment: text("environment"),
    serviceName: text("service_name").notNull(),
    serviceVersion: text("service_version"),
    serviceInstanceId: text("service_instance_id"),
    sourceRuntime: text("source_runtime").notNull(),
    sourceLanguage: text("source_language").notNull(),
    sourceFramework: text("source_framework"),
    sourceComponent: text("source_component"),
    errorType: text("error_type"),
    errorMessage: text("error_message").notNull(),
    errorCode: text("error_code"),
    errorStack: text("error_stack"),
    errorHandled: integer("error_handled", { mode: "boolean" }),
    errorDetails: text("error_details"),
    context: text("context"),
    rawPayload: text("raw_payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectIdIdx: index("error_logs_project_id_idx").on(table.projectId),
    eventIdIdx: index("error_logs_event_id_idx").on(table.eventId),
    occurredAtIdx: index("error_logs_occurred_at_idx").on(table.occurredAt),
    serviceNameIdx: index("error_logs_service_name_idx").on(table.serviceName),
  })
);

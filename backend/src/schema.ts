import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    token: text("token").notNull(),
    repairCheckoutPath: text("repair_checkout_path"),
    repairRepositoryUrl: text("repair_repository_url"),
    repairBaseCommit: text("repair_base_commit"),
    repairBackend: text("repair_backend"),
    repairAgent: text("repair_agent"),
    repairEnvironment: text("repair_environment"),
    repairTrustLevel: text("repair_trust_level"),
    repairPromotionMode: text("repair_promotion_mode").default("auto").notNull(),
    repairAutoTrigger: integer("repair_auto_trigger", { mode: "boolean" })
      .default(false)
      .notNull(),
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
    state: text("state").default("new_error").notNull(),
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
    stateIdx: index("error_logs_state_idx").on(table.state),
    eventIdIdx: index("error_logs_event_id_idx").on(table.eventId),
    occurredAtIdx: index("error_logs_occurred_at_idx").on(table.occurredAt),
    serviceNameIdx: index("error_logs_service_name_idx").on(table.serviceName),
  })
);

export const sentrySources = sqliteTable(
  "sentry_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    organizationSlug: text("organization_slug").notNull(),
    sentryProjectSlug: text("sentry_project_slug").notNull(),
    baseUrl: text("base_url").notNull(),
    authToken: text("auth_token").notNull(),
    environment: text("environment"),
    maxEventsPerPoll: integer("max_events_per_poll").default(100).notNull(),
    serviceName: text("service_name"),
    serviceVersion: text("service_version"),
    serviceInstanceId: text("service_instance_id"),
    sourceRuntime: text("source_runtime"),
    sourceLanguage: text("source_language"),
    sourceFramework: text("source_framework"),
    sourceComponent: text("source_component"),
    lastPolledAt: text("last_polled_at"),
    lastPollError: text("last_poll_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectIdIdx: index("sentry_sources_project_id_idx").on(table.projectId),
    projectSlugIdx: index("sentry_sources_project_slug_idx").on(
      table.organizationSlug,
      table.sentryProjectSlug
    ),
  })
);

export const repairAttempts = sqliteTable(
  "repair_attempts",
  {
    id: text("id").primaryKey(),
    errorLogId: text("error_log_id").notNull(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull(),
    prGate: text("pr_gate").notNull(),
    stage: text("stage").notNull(),
    selectedBackend: text("selected_backend"),
    profileId: text("profile_id"),
    artifactsDir: text("artifacts_dir").notNull(),
    targetCheckoutPath: text("target_checkout_path"),
    promotionMode: text("promotion_mode").default("auto").notNull(),
    sourcePatchStatus: text("source_patch_status").default("not_requested").notNull(),
    sourcePatchAppliedAt: text("source_patch_applied_at"),
    sourcePatchError: text("source_patch_error"),
    failureReason: text("failure_reason"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    errorLogIdIdx: index("repair_attempts_error_log_id_idx").on(table.errorLogId),
    projectIdIdx: index("repair_attempts_project_id_idx").on(table.projectId),
    createdAtIdx: index("repair_attempts_created_at_idx").on(table.createdAt),
  })
);

export const repairArtifacts = sqliteTable(
  "repair_artifacts",
  {
    id: text("id").primaryKey(),
    repairAttemptId: text("repair_attempt_id").notNull(),
    errorLogId: text("error_log_id").notNull(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    relativePath: text("relative_path").notNull(),
    absolutePath: text("absolute_path").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    repairAttemptIdIdx: index("repair_artifacts_repair_attempt_id_idx").on(
      table.repairAttemptId
    ),
    errorLogIdIdx: index("repair_artifacts_error_log_id_idx").on(table.errorLogId),
    projectIdIdx: index("repair_artifacts_project_id_idx").on(table.projectId),
  })
);

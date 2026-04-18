import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const projectConfigs = sqliteTable(
  "project_configs",
  {
    projectId: text("project_id").primaryKey(),
    serviceName: text("service_name").notNull(),
    repoPath: text("repo_path").notNull(),
    runtime: text("runtime").notNull(),
    framework: text("framework"),
    packageManager: text("package_manager"),
    installCommand: text("install_command"),
    testCommand: text("test_command"),
    entrypointPath: text("entrypoint_path"),
    endpoint: text("endpoint"),
    tokenEnvVar: text("token_env_var"),
    allowedRepairPaths: text("allowed_repair_paths").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    repoPathIdx: index("project_configs_repo_path_idx").on(table.repoPath),
    serviceNameIdx: index("project_configs_service_name_idx").on(table.serviceName),
  })
);

export const errorGroups = sqliteTable(
  "error_groups",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    eventCount: integer("event_count").notNull(),
    representativeLogId: text("representative_log_id").notNull(),
    lastLogId: text("last_log_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fingerprintIdx: index("error_groups_project_fingerprint_idx").on(
      table.projectId,
      table.fingerprint,
    ),
    projectIdIdx: index("error_groups_project_id_idx").on(table.projectId),
    statusIdx: index("error_groups_status_idx").on(table.status),
  })
);

export const repairJobs = sqliteTable(
  "repair_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    errorGroupId: text("error_group_id").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull(),
    availableAt: text("available_at").notNull(),
    lockedAt: text("locked_at"),
    workerId: text("worker_id"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    availableIdx: index("repair_jobs_available_idx").on(table.status, table.availableAt),
    errorGroupIdx: index("repair_jobs_error_group_idx").on(table.errorGroupId),
    projectIdIdx: index("repair_jobs_project_id_idx").on(table.projectId),
  })
);

export const repairAttempts = sqliteTable(
  "repair_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    projectId: text("project_id").notNull(),
    errorGroupId: text("error_group_id").notNull(),
    status: text("status").notNull(),
    workerId: text("worker_id"),
    replicatorHandoffPath: text("replicator_handoff_path"),
    patchSummary: text("patch_summary"),
    verificationCommand: text("verification_command"),
    verificationExitCode: integer("verification_exit_code"),
    verificationStdout: text("verification_stdout"),
    verificationStderr: text("verification_stderr"),
    confidence: real("confidence"),
    runDirectory: text("run_directory"),
    resultPayload: text("result_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => ({
    jobIdIdx: index("repair_attempts_job_id_idx").on(table.jobId),
    projectIdIdx: index("repair_attempts_project_id_idx").on(table.projectId),
    statusIdx: index("repair_attempts_status_idx").on(table.status),
  })
);

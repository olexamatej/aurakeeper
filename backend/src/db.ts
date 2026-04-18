import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { config } from "./config";

mkdirSync(dirname(config.databasePath), { recursive: true });

const sqlite = new Database(config.databasePath, { create: true, strict: true });

function hasColumn(tableName: string, columnName: string): boolean {
  const columns = sqlite
    .query(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  return columns.some((column) => column.name === columnName);
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS projects_token_idx
    ON projects (token);

  CREATE INDEX IF NOT EXISTS projects_name_idx
    ON projects (name);

  CREATE TABLE IF NOT EXISTS error_logs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'new_error',
    event_id TEXT,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    level TEXT NOT NULL,
    platform TEXT NOT NULL,
    environment TEXT,
    service_name TEXT NOT NULL,
    service_version TEXT,
    service_instance_id TEXT,
    source_runtime TEXT NOT NULL,
    source_language TEXT NOT NULL,
    source_framework TEXT,
    source_component TEXT,
    error_type TEXT,
    error_message TEXT NOT NULL,
    error_code TEXT,
    error_stack TEXT,
    error_handled INTEGER,
    error_details TEXT,
    context TEXT,
    raw_payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS error_logs_event_id_idx
    ON error_logs (event_id);

  CREATE INDEX IF NOT EXISTS error_logs_occurred_at_idx
    ON error_logs (occurred_at);

  CREATE INDEX IF NOT EXISTS error_logs_service_name_idx
    ON error_logs (service_name);

  CREATE TABLE IF NOT EXISTS sentry_sources (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    organization_slug TEXT NOT NULL,
    sentry_project_slug TEXT NOT NULL,
    base_url TEXT NOT NULL,
    auth_token TEXT NOT NULL,
    environment TEXT,
    max_events_per_poll INTEGER NOT NULL DEFAULT 100,
    service_name TEXT,
    service_version TEXT,
    service_instance_id TEXT,
    source_runtime TEXT,
    source_language TEXT,
    source_framework TEXT,
    source_component TEXT,
    last_polled_at TEXT,
    last_poll_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repair_attempts (
    id TEXT PRIMARY KEY NOT NULL,
    error_log_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    pr_gate TEXT NOT NULL,
    stage TEXT NOT NULL,
    selected_backend TEXT,
    profile_id TEXT,
    artifacts_dir TEXT NOT NULL,
    failure_reason TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS repair_attempts_error_log_id_idx
    ON repair_attempts (error_log_id);

  CREATE INDEX IF NOT EXISTS repair_attempts_project_id_idx
    ON repair_attempts (project_id);

  CREATE INDEX IF NOT EXISTS repair_attempts_created_at_idx
    ON repair_attempts (created_at);

  CREATE TABLE IF NOT EXISTS repair_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    repair_attempt_id TEXT NOT NULL,
    error_log_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS repair_artifacts_repair_attempt_id_idx
    ON repair_artifacts (repair_attempt_id);

  CREATE INDEX IF NOT EXISTS repair_artifacts_error_log_id_idx
    ON repair_artifacts (error_log_id);

  CREATE INDEX IF NOT EXISTS repair_artifacts_project_id_idx
    ON repair_artifacts (project_id);
`);

if (!hasColumn("error_logs", "project_id")) {
  sqlite.exec("ALTER TABLE error_logs ADD COLUMN project_id TEXT NOT NULL DEFAULT '';");
}

if (!hasColumn("error_logs", "state")) {
  sqlite.exec("ALTER TABLE error_logs ADD COLUMN state TEXT NOT NULL DEFAULT 'new_error';");
}

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS error_logs_project_id_idx
    ON error_logs (project_id);

  CREATE INDEX IF NOT EXISTS error_logs_state_idx
    ON error_logs (state);

  CREATE INDEX IF NOT EXISTS sentry_sources_project_id_idx
    ON sentry_sources (project_id);

  CREATE INDEX IF NOT EXISTS sentry_sources_project_slug_idx
    ON sentry_sources (organization_slug, sentry_project_slug);
`);

export const sqliteDb = sqlite;
export const db = drizzle(sqlite);

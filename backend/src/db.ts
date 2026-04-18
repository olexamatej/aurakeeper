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
`);

if (!hasColumn("error_logs", "project_id")) {
  sqlite.exec("ALTER TABLE error_logs ADD COLUMN project_id TEXT NOT NULL DEFAULT '';");
}

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS error_logs_project_id_idx
    ON error_logs (project_id);
`);

export const sqliteDb = sqlite;
export const db = drizzle(sqlite);

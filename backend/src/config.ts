import "dotenv/config";

import { resolve } from "node:path";

const DEFAULT_ADMIN_TOKEN = "bahno";
const DEFAULT_CORS_ALLOWED_ORIGINS = ["http://localhost:5173"];
const DEFAULT_DATABASE_PATH = "data/aurakeeper.sqlite";
const DEFAULT_ARTIFACTS_PATH = "data/artifacts";
const DEFAULT_PORT = 3000;

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PORT;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_PORT;
  }

  return parsed;
}

function parseCorsAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return DEFAULT_CORS_ALLOWED_ORIGINS;
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const config = {
  adminToken: process.env.ADMIN_TOKEN ?? DEFAULT_ADMIN_TOKEN,
  corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH),
  artifactsPath: resolve(process.cwd(), process.env.ARTIFACTS_PATH ?? DEFAULT_ARTIFACTS_PATH),
  port: parsePort(process.env.PORT),
};

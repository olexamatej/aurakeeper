import "dotenv/config";

import { resolve } from "node:path";

type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";
type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const DEFAULT_ADMIN_TOKEN = "bahno";
const DEFAULT_CORS_ALLOWED_ORIGINS = ["*"];
const DEFAULT_DATABASE_PATH = "data/aurakeeper.sqlite";
const DEFAULT_ARTIFACTS_PATH = "data/artifacts";
const DEFAULT_PORT = 3000;
const DEFAULT_CODEX_PATH = "codex";
const DEFAULT_CODEX_SANDBOX: CodexSandbox = "workspace-write";
const DEFAULT_PI_PATH = "pi";

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

function parseCodexSandbox(value: string | undefined): CodexSandbox {
  if (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  ) {
    return value;
  }

  return DEFAULT_CODEX_SANDBOX;
}

function parsePiThinkingLevel(
  value: string | undefined
): PiThinkingLevel | undefined {
  if (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  return undefined;
}

export const config = {
  adminToken: process.env.ADMIN_TOKEN ?? DEFAULT_ADMIN_TOKEN,
  corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
  databasePath: resolve(
    process.cwd(),
    process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
  ),
  artifactsPath: resolve(
    process.cwd(),
    process.env.ARTIFACTS_PATH ?? DEFAULT_ARTIFACTS_PATH,
  ),
  port: parsePort(process.env.PORT),
  codex: {
    path: process.env.CODEX_PATH ?? DEFAULT_CODEX_PATH,
    model: process.env.CODEX_MODEL,
    profile: process.env.CODEX_PROFILE,
    sandbox: parseCodexSandbox(process.env.CODEX_SANDBOX),
  },
  pi: {
    path: process.env.PI_PATH ?? DEFAULT_PI_PATH,
    provider: process.env.PI_PROVIDER,
    model: process.env.PI_MODEL,
    thinking: parsePiThinkingLevel(process.env.PI_THINKING),
  },
};

import "dotenv/config";

import { resolve } from "node:path";

const DEFAULT_ADMIN_TOKEN = "bahno";
const DEFAULT_DATABASE_PATH = "data/aurakeeper.sqlite";
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

export const config = {
  adminToken: process.env.ADMIN_TOKEN ?? DEFAULT_ADMIN_TOKEN,
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH),
  port: parsePort(process.env.PORT),
};

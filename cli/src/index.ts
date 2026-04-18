#!/usr/bin/env node

import { commands } from "./commands/index.js";

function usage(): string {
  return [
    "Usage: aurakeeper <command> [options]",
    "",
    "Commands:",
    "  hook    Add an AuraKeeper or Sentry hook to the current project using an agent",
  ].join("\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  const handler = commands[command];

  if (!handler) {
    console.error(`Unknown command: ${command}\n`);
    console.error(usage());
    process.exit(1);
  }

  await handler();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

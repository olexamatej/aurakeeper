import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runVerification } from "./runner";
import type { VerificationRunRequest } from "./types";

function usage(): string {
  return `Usage: bun run src/verification/cli.ts <request.json>

The request JSON should match VerificationRunRequest. Minimal example:

{
  "repairAttemptId": "attempt_local_1",
  "repository": { "checkoutPath": "/path/to/project" },
  "backend": "local",
  "trustLevel": "trusted",
  "environment": "local",
  "suites": ["standard"]
}
`;
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];

  if (!requestPath) {
    console.error(usage());
    process.exit(1);
  }

  const request = JSON.parse(
    await readFile(resolve(requestPath), "utf8")
  ) as VerificationRunRequest;
  const report = await runVerification(request);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.prGate === "allow" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

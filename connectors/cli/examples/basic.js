const { spawnSync } = require("node:child_process");
const { createAuraKeeperCliConnector } = require("../aurakeeper");

async function main() {
  if (!process.env.AURAKEEPER_API_TOKEN) {
    console.error("Set AURAKEEPER_API_TOKEN before running this example.");
    process.exit(1);
  }

  const connector = createAuraKeeperCliConnector({
    endpoint:
      process.env.AURAKEEPER_ENDPOINT ||
      "http://127.0.0.1:3000/v1/logs/errors",
    apiToken: process.env.AURAKEEPER_API_TOKEN,
    serviceName: "cli-example",
    serviceVersion: "0.1.0",
    environment: "development",
    component: "test-runner",
    tags: ["cli", "example"],
  });

  const result = spawnSync(
    process.execPath,
    ["-e", "process.stderr.write('tests failed\\n'); process.exit(1)"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.status !== 0) {
    await connector.captureCommandFailure(
      {
        argv: [process.execPath, "-e", "process.stderr.write('tests failed\\n'); process.exit(1)"],
        cwd: process.cwd(),
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      {
        handled: true,
        details: {
          suite: "smoke",
        },
      }
    );
  }

  await connector.flush();
}

main().catch(function onError(error) {
  console.error(error);
  process.exitCode = 1;
});

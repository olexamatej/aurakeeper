const { createAuraKeeperConnector } = require("../../aurakeeper");
const { renderWelcome } = require("./profile");

const endpoint =
  process.env.AURAKEEPER_ENDPOINT || "http://127.0.0.1:3000/v1/logs/errors";
const apiToken = process.env.AURAKEEPER_API_TOKEN;

if (!apiToken) {
  console.error("Set AURAKEEPER_API_TOKEN before running this example.");
  process.exit(1);
}

const connector = createAuraKeeperConnector({
  endpoint,
  apiToken,
  serviceName: "generic-node-service",
  serviceVersion: "1.0.0",
  environment: process.env.NODE_ENV || "development",
  framework: "node",
  component: "profile-page",
  tags: ["backend", "node-example"],
  context: {
    session: {
      source: "examples/node",
    },
  },
});

connector.install();

async function runBrokenProfile() {
  try {
    renderWelcome({
      id: "guest",
    });
  } catch (error) {
    try {
      await connector.captureException(error, {
        handled: false,
        level: "error",
        request: {
          method: "GET",
          path: "/profile",
        },
        details: {
          expectedFallback: "GUEST",
        },
      });
      await connector.flush();
    } catch (transportError) {
      console.error(`AuraKeeper transport failed: ${transportError.message}`);
    }
    throw error;
  }
}

runBrokenProfile().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

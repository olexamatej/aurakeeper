const { createAuraKeeperConnector } = require("../../aurakeeper");

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
  component: "example-worker",
  tags: ["backend", "node-example"],
  context: {
    session: {
      source: "examples/node",
    },
  },
});

connector.install();

setTimeout(function triggerUncaughtError() {
  throw new Error("Uncaught Node.js example error");
}, 10);

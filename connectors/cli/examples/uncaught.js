const { createAuraKeeperCliConnector } = require("../aurakeeper");
const { summarizeTask } = require("./task-planner");

if (!process.env.AURAKEEPER_API_TOKEN) {
  console.error("Set AURAKEEPER_API_TOKEN before running this example.");
  process.exit(1);
}

const connector = createAuraKeeperCliConnector({
  endpoint:
    process.env.AURAKEEPER_ENDPOINT || "http://127.0.0.1:3000/v1/logs/errors",
  apiToken: process.env.AURAKEEPER_API_TOKEN,
  serviceName: "cli-example",
  serviceVersion: "0.1.0",
  environment: "development",
  component: "task-planner",
});

connector.install();

setTimeout(function renderBrokenTask() {
  summarizeTask({
    title: "Rotate signing key",
  });
}, 10);

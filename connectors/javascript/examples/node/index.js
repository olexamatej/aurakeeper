const { createAuraKeeperConnector } = require("../../aurakeeper");

const exampleEndpoint = "https://api.example.com/v1/logs/errors";
const exampleApiToken = "replace-with-real-api-token";
const endpoint = process.env.AURAKEEPER_ENDPOINT || exampleEndpoint;
const apiToken = process.env.AURAKEEPER_API_TOKEN || exampleApiToken;
const useMockTransport =
  endpoint === exampleEndpoint || apiToken === exampleApiToken;

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
  transport: useMockTransport
    ? function mockTransport(config) {
        console.log("AuraKeeper node example payload", config.payload);
        return {
          status: 202,
          mocked: true,
        };
      }
    : undefined,
});

connector.install();

async function flushAndExit(signal) {
  try {
    await connector.flush();
  } finally {
    process.exit(signal === "SIGINT" ? 130 : 0);
  }
}

async function runExampleJob() {
  try {
    throw new Error("Handled Node.js example error");
  } catch (error) {
    await connector.captureException(error, {
      handled: true,
      level: "error",
      correlationId: "job_reconcile_payments_123",
      request: {
        method: "JOB",
        path: "reconcile-payments",
      },
      user: {
        id: "system",
      },
      details: {
        jobName: "reconcile-payments",
        attempt: 1,
      },
    });
  }
}

process.on("SIGINT", function onSigint() {
  flushAndExit("SIGINT");
});

process.on("SIGTERM", function onSigterm() {
  flushAndExit("SIGTERM");
});

runExampleJob()
  .then(function onComplete() {
    console.log(
      useMockTransport
        ? "Handled example error captured with mock transport."
        : "Handled example error sent to AuraKeeper."
    );
    return connector.flush();
  })
  .then(function onFlushed() {
    console.log("Connector flush completed.");
  })
  .catch(function onError(error) {
    console.error("Node example failed.", error);
    process.exitCode = 1;
  });

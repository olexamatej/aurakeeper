const { createAuraKeeperCliConnector } = require("../aurakeeper");

const connector = createAuraKeeperCliConnector({
  endpoint: process.env.AURAKEEPER_ENDPOINT || "https://api.example.com/v1/logs/errors",
  apiToken: process.env.AURAKEEPER_API_TOKEN || "dev-token",
  serviceName: "cli-example",
  serviceVersion: "0.1.0",
  environment: "development",
  component: "uncaught-demo",
  transport: function mockTransport(config) {
    console.log(JSON.stringify(config.payload, null, 2));
    return Promise.resolve({ ok: true });
  },
});

connector.install();

setTimeout(function throwUnhandledError() {
  throw new Error("Unhandled CLI crash");
}, 10);

"use strict";

const {
  createAuraKeeperNextJsConnector,
} = require("../index");

const connector = createAuraKeeperNextJsConnector({
  endpoint: "https://api.example.com/v1/logs/errors",
  apiToken: "your-api-token",
  serviceName: "aura-web",
  environment: "production",
  component: "client",
});

connector.install();

async function runClientAction() {
  try {
    throw new Error("Example client failure");
  } catch (error) {
    await connector.captureClientError(error, {
      componentStack: "at ExampleButton (app/components/example-button.js:12:3)",
    });
  }
}

module.exports = {
  connector: connector,
  runClientAction: runClientAction,
};

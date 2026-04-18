import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAuraKeeperNextJsConnector } = require("../../../../../index.js");

const endpoint = process.env.AURAKEEPER_ENDPOINT;
const apiToken = process.env.AURAKEEPER_API_TOKEN;
const connector =
  endpoint && apiToken
    ? createAuraKeeperNextJsConnector({
        endpoint,
        apiToken,
        serviceName: "nextjs-app-router-example",
        environment: process.env.NODE_ENV || "development",
        component: "app-router",
      })
    : null;

export const dynamic = "force-dynamic";

async function demoHandler(request) {
  const url = new URL(request.url);

  if (url.searchParams.get("fail") === "1") {
    throw new Error("Example App Router failure");
  }

  return Response.json({ ok: true });
}

export const GET =
  connector && typeof connector.wrapRouteHandler === "function"
    ? connector.wrapRouteHandler(demoHandler, {
        route: "/api/demo",
      })
    : demoHandler;

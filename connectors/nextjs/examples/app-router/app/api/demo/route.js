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

function renderProfile(user) {
  return `Profile: ${user.profile.displayName.toUpperCase()}`;
}

async function demoHandler(request) {
  const url = new URL(request.url);

  if (url.searchParams.get("fail") === "1") {
    return Response.json({
      message: renderProfile({
        id: "guest",
      }),
    });
  }

  return Response.json({ ok: true });
}

export function testRenderProfileFallback() {
  const actual = renderProfile({ id: "guest" });
  const expected = "Profile: GUEST";

  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

export const GET =
  connector && typeof connector.wrapRouteHandler === "function"
    ? connector.wrapRouteHandler(demoHandler, {
        route: "/api/demo",
      })
    : demoHandler;

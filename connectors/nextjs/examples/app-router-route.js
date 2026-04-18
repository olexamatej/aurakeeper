const {
  createAuraKeeperNextJsConnector,
} = require("../index");

const connector = createAuraKeeperNextJsConnector({
  endpoint: process.env.AURAKEEPER_ENDPOINT,
  apiToken: process.env.AURAKEEPER_API_TOKEN,
  serviceName: "aura-web",
  environment: process.env.NODE_ENV || "development",
  component: "app-router",
});

exports.GET = connector.wrapRouteHandler(
  async function GET(request) {
    const url = new URL(request.url);

    if (url.searchParams.get("fail") === "1") {
      throw new Error("Example App Router failure");
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
      },
    });
  },
  {
    route: "/api/demo",
  }
);

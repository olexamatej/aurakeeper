import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

const port = Number(process.env.PORT) || 3000;

console.log(`Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });

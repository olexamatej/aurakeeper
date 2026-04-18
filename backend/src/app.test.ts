import { describe, expect, test } from "bun:test";

import { app } from "./app";

describe("CORS handling", () => {
  test("responds to preflight requests for allowed origins", async () => {
    const response = await app.fetch(
      new Request("http://localhost:3000/v1/projects", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-admin-token",
        },
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "OPTIONS"
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type,x-admin-token"
    );
  });

  test("adds CORS headers to normal responses", async () => {
    const response = await app.fetch(
      new Request("http://localhost:3000/health", {
        headers: {
          Origin: "http://localhost:5173",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
    expect(response.headers.get("vary")).toBe("Origin");
  });
});

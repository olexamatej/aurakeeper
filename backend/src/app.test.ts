import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { app } from "./app";
import { db } from "./db";
import { projects } from "./schema";

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
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
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
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("vary")).toBe("Origin");
  });
});

describe("project updates", () => {
  test("updates repair auto-trigger settings for an existing project", async () => {
    const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const projectId = `proj_update_${suffix}`;

    try {
      db.insert(projects)
        .values({
          id: projectId,
          name: "Aura API",
          token: `token_${suffix}`,
          repairCheckoutPath: "/tmp/original",
          repairBackend: "local",
          repairEnvironment: "local",
          repairTrustLevel: "trusted",
          repairAutoTrigger: false,
          createdAt: new Date().toISOString(),
        })
        .run();

      const response = await app.fetch(
        new Request(`http://localhost:3000/v1/projects/${projectId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Token": "bahno",
          },
          body: JSON.stringify({
            repair: {
              checkoutPath: "/tmp/updated",
              backend: "local",
              environment: "local",
              trustLevel: "trusted",
              autoTrigger: true,
            },
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        repair?: {
          checkoutPath: string;
          backend?: string;
          environment?: string;
          trustLevel?: string;
          promotionMode?: string;
          autoTrigger: boolean;
        };
      };

      expect(body.repair).toEqual({
        checkoutPath: "/tmp/updated",
        backend: "local",
        environment: "local",
        trustLevel: "trusted",
        promotionMode: "auto",
        autoTrigger: true,
      });
    } finally {
      db.delete(projects).where(eq(projects.id, projectId)).run();
    }
  });

  test("can clear repair settings on an existing project", async () => {
    const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
    const projectId = `proj_clear_${suffix}`;

    try {
      db.insert(projects)
        .values({
          id: projectId,
          name: "Aura Web",
          token: `token_${suffix}`,
          repairCheckoutPath: "/tmp/original",
          repairBackend: "local",
          repairEnvironment: "local",
          repairTrustLevel: "trusted",
          repairAutoTrigger: true,
          createdAt: new Date().toISOString(),
        })
        .run();

      const response = await app.fetch(
        new Request(`http://localhost:3000/v1/projects/${projectId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Token": "bahno",
          },
          body: JSON.stringify({
            repair: null,
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { repair?: unknown };

      expect(body.repair).toBeUndefined();
    } finally {
      db.delete(projects).where(eq(projects.id, projectId)).run();
    }
  });
});

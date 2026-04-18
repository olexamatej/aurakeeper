import { describe, expect, test } from "bun:test";

import {
  fetchSentryProjectEvents,
  mapSentryEventToErrorLogRequest,
  type SentryEvent,
  type SentrySourceConfig,
} from "./sentry-client";

const source: SentrySourceConfig = {
  organizationSlug: "acme",
  projectSlug: "aura-web",
  authToken: "sntrys_test",
  baseUrl: "https://sentry.example.com",
  environment: "production",
  maxEventsPerPoll: 2,
  serviceName: "aura-web",
  serviceVersion: "2026.04.18",
  sourceRuntime: "node",
  sourceLanguage: "typescript",
  sourceFramework: "next.js",
  sourceComponent: "app-router",
};

describe("Sentry client", () => {
  test("paginates project events and stops at maxEventsPerPoll", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = String(input);
      calls.push(url);

      if (url.includes("cursor=cursor-1")) {
        return new Response(JSON.stringify([{ eventID: "evt_2" }]), {
          status: 200,
          headers: {
            link: '<https://sentry.example.com/api/0/projects/acme/aura-web/events/?cursor=cursor-2>; rel="next"; results="false"; cursor="cursor-2"',
          },
        });
      }

      return new Response(JSON.stringify([{ eventID: "evt_1" }]), {
        status: 200,
        headers: {
          link: '<https://sentry.example.com/api/0/projects/acme/aura-web/events/?cursor=cursor-1>; rel="next"; results="true"; cursor="cursor-1"',
        },
      });
    };

    const events = await fetchSentryProjectEvents(source, {
      start: "2026-04-18T08:00:00Z",
      end: "2026-04-18T09:00:00Z",
      fetchImpl,
    });

    expect(events).toHaveLength(2);
    expect((events[0] as SentryEvent).eventID).toBe("evt_1");
    expect((events[1] as SentryEvent).eventID).toBe("evt_2");
    expect(calls).toHaveLength(2);
  });

  test("maps a full Sentry event into AuraKeeper's error payload", () => {
    const payload = mapSentryEventToErrorLogRequest(
      {
        eventID: "evt_123",
        groupID: "grp_456",
        projectID: "789",
        dateCreated: "2026-04-18T08:32:17Z",
        platform: "javascript",
        title: "TypeError: Cannot read properties of undefined",
        culprit: "DashboardPage",
        tags: [
          { key: "level", value: "fatal" },
          { key: "environment", value: "production" },
          { key: "release", value: "2026.04.18" },
          { key: "server_name", value: "web-01" },
        ],
        user: {
          id: "user_42",
        },
        contexts: {
          browser: {
            name: "Chrome",
          },
        },
        entries: [
          {
            type: "request",
            data: {
              url: "https://app.example.com/dashboard",
              method: "GET",
            },
          },
          {
            type: "exception",
            data: {
              values: [
                {
                  type: "TypeError",
                  value: "Cannot read properties of undefined",
                  mechanism: {
                    handled: false,
                  },
                  stacktrace: {
                    frames: [
                      {
                        filename: "app/dashboard/page.tsx",
                        function: "DashboardPage",
                        lineno: 14,
                        colno: 7,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      source
    );

    expect(payload).toMatchObject({
      eventId: "evt_123",
      occurredAt: "2026-04-18T08:32:17Z",
      level: "critical",
      platform: "web",
      environment: "production",
      service: {
        name: "aura-web",
        version: "2026.04.18",
        instanceId: "web-01",
      },
      source: {
        runtime: "node",
        language: "typescript",
        framework: "next.js",
        component: "app-router",
      },
      error: {
        type: "TypeError",
        message: "Cannot read properties of undefined",
        handled: false,
      },
    });
    expect(payload.error.stack).toContain("DashboardPage");
    expect(payload.context?.request).toMatchObject({
      method: "GET",
      path: "/dashboard",
    });
    expect(payload.context?.tags).toContain("sentry");
  });
});

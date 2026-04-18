import type { CreateSentrySourceRequest, ErrorLogRequest } from "./validation";

type JsonObject = Record<string, unknown>;
type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export type SentrySourceConfig = Pick<
  CreateSentrySourceRequest,
  "organizationSlug" | "projectSlug" | "authToken" | "baseUrl" | "environment"
> & {
  maxEventsPerPoll: number;
  serviceName?: string | null;
  serviceVersion?: string | null;
  serviceInstanceId?: string | null;
  sourceRuntime?: string | null;
  sourceLanguage?: string | null;
  sourceFramework?: string | null;
  sourceComponent?: string | null;
};

export type SentryTag = {
  key?: unknown;
  value?: unknown;
};

export type SentryEventEntry = {
  type?: unknown;
  data?: unknown;
};

export type SentryExceptionValue = {
  type?: unknown;
  value?: unknown;
  mechanism?: {
    handled?: unknown;
  };
  stacktrace?: {
    frames?: Array<{
      filename?: unknown;
      function?: unknown;
      lineno?: unknown;
      colno?: unknown;
    }>;
  };
};

export type SentryEvent = {
  eventID?: unknown;
  id?: unknown;
  groupID?: unknown;
  projectID?: unknown;
  dateCreated?: unknown;
  platform?: unknown;
  title?: unknown;
  message?: unknown;
  location?: unknown;
  culprit?: unknown;
  release?: unknown;
  tags?: unknown;
  user?: unknown;
  contexts?: unknown;
  sdk?: unknown;
  metadata?: unknown;
  entries?: unknown;
};

export class SentryClientError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SentryClientError";
  }
}

export async function fetchSentryProjectEvents(
  source: SentrySourceConfig,
  options?: {
    start?: string;
    end?: string;
    fetchImpl?: FetchLike;
  }
): Promise<SentryEvent[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const maxEvents = source.maxEventsPerPoll;
  const events: SentryEvent[] = [];
  let cursor: string | undefined;

  while (events.length < maxEvents) {
    const response = await fetchImpl(
      buildProjectEventsUrl(source, {
        start: options?.start,
        end: options?.end,
        cursor,
      }),
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${source.authToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorBody = await safeReadText(response);
      throw new SentryClientError(
        `Sentry request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
        response.status
      );
    }

    const page = await response.json();

    if (!Array.isArray(page)) {
      throw new SentryClientError("Sentry returned an unexpected project events payload");
    }

    for (const event of page) {
      if (events.length >= maxEvents) {
        break;
      }

      events.push(event as SentryEvent);
    }

    const nextCursor = getNextCursor(response.headers.get("link"));

    if (!nextCursor) {
      break;
    }

    cursor = nextCursor;
  }

  return events;
}

export function mapSentryEventToErrorLogRequest(
  event: SentryEvent,
  source: SentrySourceConfig
): ErrorLogRequest {
  const tags = getTagMap(event.tags);
  const requestEntry = getRequestEntry(event.entries);
  const exception = getPrimaryException(event.entries);
  const occurredAt = asNonEmptyString(event.dateCreated) ?? new Date().toISOString();
  const runtime = source.sourceRuntime ?? readRuntime(tags, event.platform) ?? "unknown";
  const language = source.sourceLanguage ?? readLanguage(tags, event.platform, runtime) ?? "unknown";
  const framework = source.sourceFramework ?? readFramework(tags);
  const component =
    source.sourceComponent ??
    asNonEmptyString(event.culprit) ??
    asNonEmptyString(event.location) ??
    undefined;
  const errorType =
    asNonEmptyString(exception?.type) ??
    asNonEmptyString(readMetadataValue(event.metadata, "type")) ??
    undefined;
  const errorMessage =
    asNonEmptyString(exception?.value) ??
    asNonEmptyString(readMetadataValue(event.metadata, "value")) ??
    asNonEmptyString(event.message) ??
    asNonEmptyString(event.title) ??
    "Unknown Sentry error";

  return {
    eventId: asNonEmptyString(event.eventID) ?? asNonEmptyString(event.id) ?? undefined,
    occurredAt,
    level: normalizeLevel(tags.level),
    platform: readPlatform(event.platform, tags, requestEntry),
    environment: asNonEmptyString(tags.environment) ?? asNonEmptyString(tags.env),
    service: {
      name: source.serviceName ?? source.projectSlug,
      version:
        source.serviceVersion ??
        readReleaseVersion(event.release) ??
        asNonEmptyString(tags.release) ??
        undefined,
      instanceId:
        source.serviceInstanceId ??
        asNonEmptyString(tags.server_name) ??
        asNonEmptyString(tags.host) ??
        undefined,
    },
    source: compactObject({
      runtime,
      language,
      framework,
      component,
    }) as ErrorLogRequest["source"],
    error: compactObject({
      type: errorType,
      message: errorMessage,
      code: asNonEmptyString(tags.error_code) ?? undefined,
      stack: buildStackTrace(exception, errorType, errorMessage),
      handled: readHandled(exception, tags),
      details: compactObject({
        sentry: compactObject({
          eventId: asNonEmptyString(event.eventID) ?? asNonEmptyString(event.id),
          issueId: asNonEmptyString(event.groupID),
          projectId: asNonEmptyString(event.projectID),
          title: asNonEmptyString(event.title),
          culprit: asNonEmptyString(event.culprit),
          location: asNonEmptyString(event.location),
          platform: asNonEmptyString(event.platform),
          sdk: isRecord(event.sdk) ? event.sdk : undefined,
        }),
      }) as JsonObject,
    }) as ErrorLogRequest["error"],
    context: compactObject({
      request: buildRequestContext(requestEntry),
      user: isRecord(event.user) ? sanitizeJsonObject(event.user) : undefined,
      device: buildDeviceContext(event.contexts),
      correlationId:
        asNonEmptyString(tags.trace_id) ??
        asNonEmptyString(tags.trace) ??
        asNonEmptyString(tags.transaction),
      tags: buildContextTags(tags, source.projectSlug, asNonEmptyString(event.groupID)),
      sentryContexts: isRecord(event.contexts) ? sanitizeJsonObject(event.contexts) : undefined,
    }) as ErrorLogRequest["context"],
  };
}

function buildProjectEventsUrl(
  source: SentrySourceConfig,
  options?: {
    start?: string;
    end?: string;
    cursor?: string;
  }
): string {
  const url = new URL(
    `/api/0/projects/${encodeURIComponent(source.organizationSlug)}/${encodeURIComponent(
      source.projectSlug
    )}/events/`,
    normalizeBaseUrl(source.baseUrl)
  );

  url.searchParams.set("full", "1");

  if (options?.start) {
    url.searchParams.set("start", options.start);
  }

  if (options?.end) {
    url.searchParams.set("end", options.end);
  }

  if (options?.cursor) {
    url.searchParams.set("cursor", options.cursor);
  }

  return url.toString();
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const normalized = new URL(baseUrl ?? "https://sentry.io");

  normalized.pathname = normalized.pathname.replace(/\/+$/, "");

  if (!normalized.pathname.endsWith("/")) {
    normalized.pathname = `${normalized.pathname}/`;
  }

  return normalized.toString();
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function getNextCursor(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }

  const parts = linkHeader.split(",");

  for (const part of parts) {
    if (!part.includes('rel="next"')) {
      continue;
    }

    if (part.includes('results="false"')) {
      return undefined;
    }

    const match = part.match(/cursor="([^"]+)"/);

    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function getPrimaryException(entries: unknown): SentryExceptionValue | undefined {
  const exceptionEntry = asArray(entries).find((entry) => {
    return isRecord(entry) && entry.type === "exception";
  });

  if (!isRecord(exceptionEntry) || !isRecord(exceptionEntry.data)) {
    return undefined;
  }

  const values = asArray(exceptionEntry.data.values);

  if (values.length === 0) {
    return undefined;
  }

  const candidate = values[values.length - 1];

  return isRecord(candidate) ? (candidate as SentryExceptionValue) : undefined;
}

function getRequestEntry(entries: unknown): JsonObject | undefined {
  const requestEntry = asArray(entries).find((entry) => {
    return isRecord(entry) && entry.type === "request";
  });

  if (!isRecord(requestEntry) || !isRecord(requestEntry.data)) {
    return undefined;
  }

  return requestEntry.data;
}

function buildRequestContext(entry: JsonObject | undefined): JsonObject | undefined {
  if (!entry) {
    return undefined;
  }

  const urlValue = asNonEmptyString(entry.url);
  let path: string | undefined;

  if (urlValue) {
    try {
      path = new URL(urlValue).pathname;
    } catch {
      path = undefined;
    }
  }

  return compactObject({
    method: asNonEmptyString(entry.method),
    path,
    url: urlValue,
    query: asNonEmptyString(entry.query_string),
    headers: isRecord(entry.headers) ? sanitizeJsonObject(entry.headers) : undefined,
    data: isRecord(entry.data) ? sanitizeJsonObject(entry.data) : undefined,
  });
}

function buildDeviceContext(contexts: unknown): JsonObject | undefined {
  if (!isRecord(contexts)) {
    return undefined;
  }

  return compactObject({
    device: isRecord(contexts.device) ? sanitizeJsonObject(contexts.device) : undefined,
    os: isRecord(contexts.os) ? sanitizeJsonObject(contexts.os) : undefined,
    browser: isRecord(contexts.browser) ? sanitizeJsonObject(contexts.browser) : undefined,
    runtime: isRecord(contexts.runtime) ? sanitizeJsonObject(contexts.runtime) : undefined,
  });
}

function buildContextTags(
  tags: Record<string, string>,
  projectSlug: string,
  issueId: string | undefined
): string[] {
  const values = [`sentry`, `sentry:project:${projectSlug}`];

  if (issueId) {
    values.push(`sentry:issue:${issueId}`);
  }

  for (const key of ["environment", "level", "release"]) {
    if (tags[key]) {
      values.push(`sentry:${key}:${tags[key]}`);
    }
  }

  return Array.from(new Set(values));
}

function getTagMap(tags: unknown): Record<string, string> {
  const result: Record<string, string> = {};

  for (const entry of asArray(tags)) {
    if (!isRecord(entry)) {
      continue;
    }

    const key = asNonEmptyString(entry.key);
    const value = asNonEmptyString(entry.value);

    if (!key || !value) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

function buildStackTrace(
  exception: SentryExceptionValue | undefined,
  errorType: string | undefined,
  errorMessage: string
): string | undefined {
  const frames = asArray(exception?.stacktrace?.frames).filter(isRecord);

  if (frames.length === 0) {
    return undefined;
  }

  const lines = [`${errorType ?? "Error"}: ${errorMessage}`];

  for (const frame of frames) {
    const location = [
      asNonEmptyString(frame.filename) ?? "<unknown>",
      typeof frame.lineno === "number" ? String(frame.lineno) : undefined,
      typeof frame.colno === "number" ? String(frame.colno) : undefined,
    ]
      .filter((value): value is string => value !== undefined)
      .join(":");

    const functionName = asNonEmptyString(frame.function) ?? "<anonymous>";
    lines.push(`    at ${functionName} (${location})`);
  }

  return lines.join("\n");
}

function readHandled(
  exception: SentryExceptionValue | undefined,
  tags: Record<string, string>
): boolean | undefined {
  if (typeof exception?.mechanism?.handled === "boolean") {
    return exception.mechanism.handled;
  }

  if (tags.handled === "yes" || tags.handled === "true") {
    return true;
  }

  if (tags.handled === "no" || tags.handled === "false") {
    return false;
  }

  return undefined;
}

function readPlatform(
  platformValue: unknown,
  tags: Record<string, string>,
  requestEntry: JsonObject | undefined
): string {
  const platform = normalizeLowerString(platformValue);
  const runtime = normalizeLowerString(tags.runtime);

  if (
    platform === "react-native" ||
    runtime.includes("react-native") ||
    platform === "android" ||
    platform === "cocoa" ||
    platform === "swift"
  ) {
    return "mobile";
  }

  if (
    platform === "javascript" ||
    runtime.includes("browser") ||
    requestEntry?.url !== undefined
  ) {
    return "web";
  }

  if (runtime.includes("worker") || normalizeLowerString(tags.queue).length > 0) {
    return "worker";
  }

  return "backend";
}

function readRuntime(tags: Record<string, string>, platformValue: unknown): string | undefined {
  return asNonEmptyString(tags.runtime) ?? asNonEmptyString(platformValue) ?? undefined;
}

function readLanguage(
  tags: Record<string, string>,
  platformValue: unknown,
  runtime: string
): string | undefined {
  const candidate = normalizeLowerString(tags.runtime) || normalizeLowerString(platformValue);

  if (candidate.includes("typescript")) {
    return "typescript";
  }

  if (
    candidate.includes("javascript") ||
    candidate.includes("node") ||
    runtime.toLowerCase().includes("node")
  ) {
    return "javascript";
  }

  if (candidate.includes("python")) {
    return "python";
  }

  if (candidate.includes("php")) {
    return "php";
  }

  if (candidate.includes("ruby")) {
    return "ruby";
  }

  if (candidate.includes("go")) {
    return "go";
  }

  if (candidate.includes("java")) {
    return "java";
  }

  if (candidate.includes("cocoa") || candidate.includes("swift")) {
    return "swift";
  }

  if (candidate.includes("android") || candidate.includes("kotlin")) {
    return "kotlin";
  }

  if (candidate.includes("csharp") || candidate.includes("dotnet") || candidate.includes(".net")) {
    return "csharp";
  }

  return undefined;
}

function readFramework(tags: Record<string, string>): string | undefined {
  return asNonEmptyString(tags.runtime_name) ?? asNonEmptyString(tags.framework) ?? undefined;
}

function normalizeLevel(level: string | undefined): ErrorLogRequest["level"] {
  const normalized = normalizeLowerString(level);

  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warning" ||
    normalized === "error" ||
    normalized === "critical"
  ) {
    return normalized;
  }

  if (normalized === "fatal") {
    return "critical";
  }

  return "error";
}

function readReleaseVersion(release: unknown): string | undefined {
  if (typeof release === "string" && release.length > 0) {
    return release;
  }

  if (isRecord(release)) {
    return asNonEmptyString(release.version) ?? asNonEmptyString(release.shortVersion) ?? undefined;
  }

  return undefined;
}

function readMetadataValue(metadata: unknown, key: string): unknown {
  if (!isRecord(metadata)) {
    return undefined;
  }

  return metadata[key];
}

function sanitizeJsonObject(value: JsonObject): JsonObject {
  const result: JsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeJsonValue(entry);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  return result;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonValue(entry))
      .filter((entry) => entry !== undefined);
  }

  if (isRecord(value)) {
    return sanitizeJsonObject(value);
  }

  return undefined;
}

function compactObject<T extends JsonObject>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeLowerString(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

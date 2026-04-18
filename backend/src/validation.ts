const LEVELS = new Set(["debug", "info", "warning", "error", "critical"]);
const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISSUE_STATES = [
  "new_error",
  "repro_started",
  "repro_succeeded",
  "repro_failed",
  "fix_started",
  "fix_succeeded",
  "fix_failed",
  "verify_started",
  "verify_succeeded",
  "verify_failed",
  "deploy_started",
  "deploy_succeeded",
  "deploy_failed",
] as const;

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

type ServiceDescriptor = {
  name: string;
  version?: string;
  instanceId?: string;
};

type ServiceDescriptorOverrides = {
  name?: string;
  version?: string;
  instanceId?: string;
};

type ErrorSource = {
  runtime: string;
  language: string;
  framework?: string;
  component?: string;
};

type ErrorSourceOverrides = {
  runtime?: string;
  language?: string;
  framework?: string;
  component?: string;
};

type ErrorPayload = {
  type?: string;
  message: string;
  code?: string;
  stack?: string;
  handled?: boolean;
  details?: JsonObject;
};

type ErrorContext = JsonObject & {
  request?: JsonObject;
  user?: JsonObject;
  session?: JsonObject;
  device?: JsonObject;
  correlationId?: string;
  tags?: string[];
};

export type ErrorLogRequest = {
  eventId?: string;
  occurredAt: string;
  level: "debug" | "info" | "warning" | "error" | "critical";
  platform: string;
  environment?: string;
  service: ServiceDescriptor;
  source: ErrorSource;
  error: ErrorPayload;
  context?: ErrorContext;
};

export type CreateProjectRequest = {
  name: string;
  repair?: ProjectRepairSettings;
};

export type UpdateProjectRequest = {
  name?: string;
  repair?: ProjectRepairSettings | null;
};

export type ProjectRepairSettings = {
  checkoutPath: string;
  repositoryUrl?: string;
  baseCommit?: string;
  backend?: "docker" | "local" | "auto";
  environment?: "production" | "hosted" | "local" | "development";
  trustLevel?: "trusted" | "untrusted";
  autoTrigger?: boolean;
  promotionMode?: "auto" | "manual";
};

export type CreateRepairAttemptRequest = {
  issueSummary?: string;
};

export type CreateSentrySourceRequest = {
  organizationSlug: string;
  projectSlug: string;
  authToken: string;
  baseUrl?: string;
  environment?: string;
  maxEventsPerPoll?: number;
  service?: ServiceDescriptorOverrides;
  source?: ErrorSourceOverrides;
};

export type IssueState = (typeof ISSUE_STATES)[number];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isIssueState(value: string): value is IssueState {
  return ISSUE_STATES.includes(value as IssueState);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isObject(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function assertObject(
  value: unknown,
  field: string
): asserts value is Record<string, unknown> {
  if (!isObject(value)) {
    throw new ApiError(400, "invalid_request", `${field} must be an object`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  field: string
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));

  if (unknownKeys.length > 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `${field} contains unsupported field: ${unknownKeys[0]}`
    );
  }
}

function getRequiredString(
  value: Record<string, unknown>,
  key: string,
  field: string
): string {
  const candidate = value[key];

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a non-empty string`);
  }

  return candidate;
}

function getOptionalString(
  value: Record<string, unknown>,
  key: string,
  field: string
): string | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== "string") {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a string`);
  }

  return candidate;
}

function getOptionalNonEmptyString(
  value: Record<string, unknown>,
  key: string,
  field: string
): string | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a non-empty string`);
  }

  return candidate;
}

function getOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
  field: string
): boolean | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== "boolean") {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a boolean`);
  }

  return candidate;
}

function getOptionalInteger(
  value: Record<string, unknown>,
  key: string,
  field: string
): number | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (!Number.isInteger(candidate)) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be an integer`);
  }

  return candidate as number;
}

function getOptionalJsonObject(
  value: Record<string, unknown>,
  key: string,
  field: string
): JsonObject | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (!isObject(candidate) || !Object.values(candidate).every(isJsonValue)) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a JSON object`);
  }

  return candidate as JsonObject;
}

function parseServiceDescriptor(value: unknown): ServiceDescriptor {
  assertObject(value, "service");
  assertAllowedKeys(value, ["name", "version", "instanceId"], "service");

  return {
    name: getRequiredString(value, "name", "service"),
    version: getOptionalString(value, "version", "service"),
    instanceId: getOptionalString(value, "instanceId", "service"),
  };
}

function parseServiceDescriptorOverrides(
  value: unknown
): ServiceDescriptorOverrides | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertObject(value, "service");
  assertAllowedKeys(value, ["name", "version", "instanceId"], "service");

  const name = getOptionalNonEmptyString(value, "name", "service");
  const version = getOptionalNonEmptyString(value, "version", "service");
  const instanceId = getOptionalNonEmptyString(value, "instanceId", "service");

  if (name === undefined && version === undefined && instanceId === undefined) {
    return undefined;
  }

  return {
    name,
    version,
    instanceId,
  };
}

function parseProjectRepairSettings(value: unknown): ProjectRepairSettings | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertObject(value, "repair");
  assertAllowedKeys(
    value,
    [
      "checkoutPath",
      "repositoryUrl",
      "baseCommit",
      "backend",
      "environment",
      "trustLevel",
      "autoTrigger",
      "promotionMode",
    ],
    "repair"
  );

  const checkoutPath = getRequiredString(value, "checkoutPath", "repair");
  const repositoryUrl = getOptionalNonEmptyString(value, "repositoryUrl", "repair");
  const baseCommit = getOptionalNonEmptyString(value, "baseCommit", "repair");
  const backend = getOptionalNonEmptyString(value, "backend", "repair");
  const environment = getOptionalNonEmptyString(value, "environment", "repair");
  const trustLevel = getOptionalNonEmptyString(value, "trustLevel", "repair");
  const autoTrigger = getOptionalBoolean(value, "autoTrigger", "repair");
  const promotionMode = getOptionalNonEmptyString(value, "promotionMode", "repair");

  if (backend && backend !== "docker" && backend !== "local" && backend !== "auto") {
    throw new ApiError(
      400,
      "invalid_request",
      "repair.backend must be one of: auto, docker, local"
    );
  }

  if (
    environment &&
    environment !== "production" &&
    environment !== "hosted" &&
    environment !== "local" &&
    environment !== "development"
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "repair.environment must be one of: production, hosted, local, development"
    );
  }

  if (trustLevel && trustLevel !== "trusted" && trustLevel !== "untrusted") {
    throw new ApiError(
      400,
      "invalid_request",
      "repair.trustLevel must be one of: trusted, untrusted"
    );
  }

  if (promotionMode && promotionMode !== "auto" && promotionMode !== "manual") {
    throw new ApiError(
      400,
      "invalid_request",
      "repair.promotionMode must be one of: auto, manual"
    );
  }

  return {
    checkoutPath,
    repositoryUrl,
    baseCommit,
    backend: backend as ProjectRepairSettings["backend"] | undefined,
    environment: environment as ProjectRepairSettings["environment"] | undefined,
    trustLevel: trustLevel as ProjectRepairSettings["trustLevel"] | undefined,
    autoTrigger,
    promotionMode: promotionMode as ProjectRepairSettings["promotionMode"] | undefined,
  };
}

function parseErrorSource(value: unknown): ErrorSource {
  assertObject(value, "source");
  assertAllowedKeys(value, ["runtime", "language", "framework", "component"], "source");

  return {
    runtime: getRequiredString(value, "runtime", "source"),
    language: getRequiredString(value, "language", "source"),
    framework: getOptionalString(value, "framework", "source"),
    component: getOptionalString(value, "component", "source"),
  };
}

function parseErrorSourceOverrides(value: unknown): ErrorSourceOverrides | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertObject(value, "source");
  assertAllowedKeys(value, ["runtime", "language", "framework", "component"], "source");

  const runtime = getOptionalNonEmptyString(value, "runtime", "source");
  const language = getOptionalNonEmptyString(value, "language", "source");
  const framework = getOptionalNonEmptyString(value, "framework", "source");
  const component = getOptionalNonEmptyString(value, "component", "source");

  if (
    runtime === undefined &&
    language === undefined &&
    framework === undefined &&
    component === undefined
  ) {
    return undefined;
  }

  return {
    runtime,
    language,
    framework,
    component,
  };
}

function parseErrorPayload(value: unknown): ErrorPayload {
  assertObject(value, "error");
  assertAllowedKeys(value, ["type", "message", "code", "stack", "handled", "details"], "error");

  return {
    type: getOptionalString(value, "type", "error"),
    message: getRequiredString(value, "message", "error"),
    code: getOptionalString(value, "code", "error"),
    stack: getOptionalString(value, "stack", "error"),
    handled: getOptionalBoolean(value, "handled", "error"),
    details: getOptionalJsonObject(value, "details", "error"),
  };
}

function parseContext(value: unknown): ErrorContext {
  assertObject(value, "context");

  for (const [key, candidate] of Object.entries(value)) {
    if (!isJsonValue(candidate)) {
      throw new ApiError(400, "invalid_request", `context.${key} must be valid JSON`);
    }
  }

  if (value.request !== undefined && !isObject(value.request)) {
    throw new ApiError(400, "invalid_request", "context.request must be a JSON object");
  }

  if (value.user !== undefined && !isObject(value.user)) {
    throw new ApiError(400, "invalid_request", "context.user must be a JSON object");
  }

  if (value.session !== undefined && !isObject(value.session)) {
    throw new ApiError(400, "invalid_request", "context.session must be a JSON object");
  }

  if (value.device !== undefined && !isObject(value.device)) {
    throw new ApiError(400, "invalid_request", "context.device must be a JSON object");
  }

  if (value.correlationId !== undefined && typeof value.correlationId !== "string") {
    throw new ApiError(400, "invalid_request", "context.correlationId must be a string");
  }

  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || !value.tags.every((entry) => typeof entry === "string")) {
      throw new ApiError(400, "invalid_request", "context.tags must be an array of strings");
    }
  }

  return value as ErrorContext;
}

export function parseErrorLogRequest(value: unknown): ErrorLogRequest {
  assertObject(value, "body");
  assertAllowedKeys(
    value,
    [
      "eventId",
      "occurredAt",
      "level",
      "platform",
      "environment",
      "service",
      "source",
      "error",
      "context",
    ],
    "body"
  );

  if (value.eventId !== undefined && typeof value.eventId !== "string") {
    throw new ApiError(400, "invalid_request", "eventId must be a string");
  }

  if (typeof value.occurredAt !== "string" || !RFC3339_DATE_TIME.test(value.occurredAt)) {
    throw new ApiError(
      400,
      "invalid_request",
      "occurredAt must be a valid RFC 3339 timestamp"
    );
  }

  if (Number.isNaN(Date.parse(value.occurredAt))) {
    throw new ApiError(
      400,
      "invalid_request",
      "occurredAt must be a valid RFC 3339 timestamp"
    );
  }

  if (typeof value.level !== "string" || !LEVELS.has(value.level)) {
    throw new ApiError(
      400,
      "invalid_request",
      "level must be one of: debug, info, warning, error, critical"
    );
  }

  if (typeof value.platform !== "string" || value.platform.length === 0) {
    throw new ApiError(400, "invalid_request", "platform must be a non-empty string");
  }

  if (value.environment !== undefined && typeof value.environment !== "string") {
    throw new ApiError(400, "invalid_request", "environment must be a string");
  }

  return {
    eventId: value.eventId,
    occurredAt: value.occurredAt,
    level: value.level as ErrorLogRequest["level"],
    platform: value.platform,
    environment: value.environment,
    service: parseServiceDescriptor(value.service),
    source: parseErrorSource(value.source),
    error: parseErrorPayload(value.error),
    context: value.context === undefined ? undefined : parseContext(value.context),
  };
}

export function parseCreateProjectRequest(value: unknown): CreateProjectRequest {
  assertObject(value, "body");
  assertAllowedKeys(value, ["name", "repair"], "body");

  return {
    name: getRequiredString(value, "name", "body"),
    repair: parseProjectRepairSettings(value.repair),
  };
}

export function parseUpdateProjectRequest(value: unknown): UpdateProjectRequest {
  assertObject(value, "body");
  assertAllowedKeys(value, ["name", "repair"], "body");

  const name = getOptionalNonEmptyString(value, "name", "body");
  let repair: ProjectRepairSettings | null | undefined;

  if (value.repair === null) {
    repair = null;
  } else {
    repair = parseProjectRepairSettings(value.repair);
  }

  if (name === undefined && repair === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      "body must include at least one of: name, repair"
    );
  }

  return {
    name,
    repair,
  };
}

export function parseCreateRepairAttemptRequest(value: unknown): CreateRepairAttemptRequest {
  assertObject(value, "body");
  assertAllowedKeys(value, ["issueSummary"], "body");

  return {
    issueSummary: getOptionalNonEmptyString(value, "issueSummary", "body"),
  };
}

export function parseCreateSentrySourceRequest(
  value: unknown
): CreateSentrySourceRequest {
  assertObject(value, "body");
  assertAllowedKeys(
    value,
    [
      "organizationSlug",
      "projectSlug",
      "authToken",
      "baseUrl",
      "environment",
      "maxEventsPerPoll",
      "service",
      "source",
    ],
    "body"
  );

  const baseUrl = getOptionalNonEmptyString(value, "baseUrl", "body");

  if (baseUrl !== undefined) {
    try {
      new URL(baseUrl);
    } catch {
      throw new ApiError(400, "invalid_request", "body.baseUrl must be a valid URL");
    }
  }

  const maxEventsPerPoll = getOptionalInteger(value, "maxEventsPerPoll", "body");

  if (maxEventsPerPoll !== undefined && (maxEventsPerPoll < 1 || maxEventsPerPoll > 500)) {
    throw new ApiError(
      400,
      "invalid_request",
      "body.maxEventsPerPoll must be between 1 and 500"
    );
  }

  return {
    organizationSlug: getRequiredString(value, "organizationSlug", "body"),
    projectSlug: getRequiredString(value, "projectSlug", "body"),
    authToken: getRequiredString(value, "authToken", "body"),
    baseUrl,
    environment: getOptionalNonEmptyString(value, "environment", "body"),
    maxEventsPerPoll,
    service: parseServiceDescriptorOverrides(value.service),
    source: parseErrorSourceOverrides(value.source),
  };
}

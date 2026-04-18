import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ApiError } from "./validation";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type CollectorInventoryItem = {
  id: string;
  runtime: string;
  framework?: string;
  description: string;
  installStrategy: "dependency" | "vendor";
};

export type CollectorSelectionRequest = {
  repoPath: string;
  packageManager?: string;
  runtimeCandidates: string[];
  frameworkCandidates: string[];
  topLevelFiles: string[];
  lockfiles: string[];
  likelyEntrypoints: string[];
  packageManifest?: Record<string, JsonValue>;
  collectorInventory: CollectorInventoryItem[];
  autoPatchAllowed: boolean;
};

export type CollectorSelectionResult = {
  collectorId: string;
  runtime: string;
  framework?: string;
  strategy: "dependency" | "vendor" | "manual_only";
  bootstrapFile: string;
  entrypointPath?: string;
  patchMode: "auto_patch" | "generate_import_only";
  confidence: number;
  reason: string;
  edits: string[];
  warnings: string[];
  selectorSource: "codex" | "fallback";
};

export type ProjectConfigRequest = {
  serviceName: string;
  repoPath: string;
  runtime: string;
  framework?: string;
  packageManager?: string;
  installCommand?: string;
  testCommand?: string;
  entrypointPath?: string;
  endpoint?: string;
  tokenEnvVar?: string;
  allowedRepairPaths: string[];
};

export type RepairJobClaimRequest = {
  workerId: string;
};

export type RepairJobCompleteRequest = {
  attemptId: string;
  status: "patched" | "failed" | "needs_manual_review";
  replicatorHandoffPath?: string;
  patchSummary?: string;
  verificationCommand?: string;
  verificationExitCode?: number;
  verificationStdout?: string;
  verificationStderr?: string;
  confidence?: number;
  runDirectory?: string;
  resultPayload?: Record<string, JsonValue>;
  failureReason?: string;
};

const execFile = promisify(execFileCallback);

const SELECTOR_SCHEMA = {
  name: "collector_selection",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "collectorId",
      "runtime",
      "framework",
      "strategy",
      "bootstrapFile",
      "entrypointPath",
      "patchMode",
      "confidence",
      "reason",
      "edits",
      "warnings",
    ],
    properties: {
      collectorId: { type: "string" },
      runtime: { type: "string" },
      framework: {
        type: ["string", "null"],
      },
      strategy: {
        type: "string",
        enum: ["dependency", "vendor", "manual_only"],
      },
      bootstrapFile: { type: "string" },
      entrypointPath: {
        type: ["string", "null"],
      },
      patchMode: {
        type: "string",
        enum: ["auto_patch", "generate_import_only"],
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      reason: { type: "string" },
      edits: {
        type: "array",
        items: { type: "string" },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

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
  field: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) {
    throw new ApiError(400, "invalid_request", `${field} must be an object`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  field: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));

  if (unknownKeys.length > 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `${field} contains unsupported field: ${unknownKeys[0]}`,
    );
  }
}

function getRequiredString(
  value: Record<string, unknown>,
  key: string,
  field: string,
): string {
  const candidate = value[key];

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a non-empty string`);
  }

  return candidate;
}

function getRequiredFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  field: string,
): number {
  const candidate = value[key];

  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a finite number`);
  }

  return candidate;
}

function getOptionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  field: string,
): number | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a finite number`);
  }

  return candidate;
}

function getOptionalString(
  value: Record<string, unknown>,
  key: string,
  field: string,
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

function getRequiredStringArray(
  value: Record<string, unknown>,
  key: string,
  field: string,
): string[] {
  const candidate = value[key];

  if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== "string")) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be an array of strings`);
  }

  return candidate;
}

function getOptionalJsonObject(
  value: Record<string, unknown>,
  key: string,
  field: string,
): Record<string, JsonValue> | undefined {
  const candidate = value[key];

  if (candidate === undefined) {
    return undefined;
  }

  if (!isObject(candidate) || !Object.values(candidate).every(isJsonValue)) {
    throw new ApiError(400, "invalid_request", `${field}.${key} must be a JSON object`);
  }

  return candidate as Record<string, JsonValue>;
}

function parseCollectorInventory(value: unknown): CollectorInventoryItem[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_request", "body.collectorInventory must be an array");
  }

  return value.map((entry, index) => {
    assertObject(entry, `body.collectorInventory[${index}]`);
    assertAllowedKeys(
      entry,
      ["id", "runtime", "framework", "description", "installStrategy"],
      `body.collectorInventory[${index}]`,
    );

    const installStrategy = getRequiredString(
      entry,
      "installStrategy",
      `body.collectorInventory[${index}]`,
    );

    if (installStrategy !== "dependency" && installStrategy !== "vendor") {
      throw new ApiError(
        400,
        "invalid_request",
        `body.collectorInventory[${index}].installStrategy must be dependency or vendor`,
      );
    }

    return {
      id: getRequiredString(entry, "id", `body.collectorInventory[${index}]`),
      runtime: getRequiredString(entry, "runtime", `body.collectorInventory[${index}]`),
      framework: getOptionalString(entry, "framework", `body.collectorInventory[${index}]`),
      description: getRequiredString(
        entry,
        "description",
        `body.collectorInventory[${index}]`,
      ),
      installStrategy,
    } as CollectorInventoryItem;
  });
}

export function parseCollectorSelectionRequest(value: unknown): CollectorSelectionRequest {
  assertObject(value, "body");
  assertAllowedKeys(
    value,
    [
      "repoPath",
      "packageManager",
      "runtimeCandidates",
      "frameworkCandidates",
      "topLevelFiles",
      "lockfiles",
      "likelyEntrypoints",
      "packageManifest",
      "collectorInventory",
      "autoPatchAllowed",
    ],
    "body",
  );

  if (typeof value.autoPatchAllowed !== "boolean") {
    throw new ApiError(400, "invalid_request", "body.autoPatchAllowed must be a boolean");
  }

  return {
    repoPath: getRequiredString(value, "repoPath", "body"),
    packageManager: getOptionalString(value, "packageManager", "body"),
    runtimeCandidates: getRequiredStringArray(value, "runtimeCandidates", "body"),
    frameworkCandidates: getRequiredStringArray(value, "frameworkCandidates", "body"),
    topLevelFiles: getRequiredStringArray(value, "topLevelFiles", "body"),
    lockfiles: getRequiredStringArray(value, "lockfiles", "body"),
    likelyEntrypoints: getRequiredStringArray(value, "likelyEntrypoints", "body"),
    packageManifest: getOptionalJsonObject(value, "packageManifest", "body"),
    collectorInventory: parseCollectorInventory(value.collectorInventory),
    autoPatchAllowed: value.autoPatchAllowed,
  };
}

export function parseProjectConfigRequest(value: unknown): ProjectConfigRequest {
  assertObject(value, "body");
  assertAllowedKeys(
    value,
    [
      "serviceName",
      "repoPath",
      "runtime",
      "framework",
      "packageManager",
      "installCommand",
      "testCommand",
      "entrypointPath",
      "endpoint",
      "tokenEnvVar",
      "allowedRepairPaths",
    ],
    "body",
  );

  return {
    serviceName: getRequiredString(value, "serviceName", "body"),
    repoPath: getRequiredString(value, "repoPath", "body"),
    runtime: getRequiredString(value, "runtime", "body"),
    framework: getOptionalString(value, "framework", "body"),
    packageManager: getOptionalString(value, "packageManager", "body"),
    installCommand: getOptionalString(value, "installCommand", "body"),
    testCommand: getOptionalString(value, "testCommand", "body"),
    entrypointPath: getOptionalString(value, "entrypointPath", "body"),
    endpoint: getOptionalString(value, "endpoint", "body"),
    tokenEnvVar: getOptionalString(value, "tokenEnvVar", "body"),
    allowedRepairPaths: getRequiredStringArray(value, "allowedRepairPaths", "body"),
  };
}

export function parseRepairJobClaimRequest(value: unknown): RepairJobClaimRequest {
  assertObject(value, "body");
  assertAllowedKeys(value, ["workerId"], "body");

  return {
    workerId: getRequiredString(value, "workerId", "body"),
  };
}

export function parseRepairJobCompleteRequest(value: unknown): RepairJobCompleteRequest {
  assertObject(value, "body");
  assertAllowedKeys(
    value,
    [
      "attemptId",
      "status",
      "replicatorHandoffPath",
      "patchSummary",
      "verificationCommand",
      "verificationExitCode",
      "verificationStdout",
      "verificationStderr",
      "confidence",
      "runDirectory",
      "resultPayload",
      "failureReason",
    ],
    "body",
  );

  const status = getRequiredString(value, "status", "body");

  if (!["patched", "failed", "needs_manual_review"].includes(status)) {
    throw new ApiError(
      400,
      "invalid_request",
      "body.status must be patched, failed, or needs_manual_review",
    );
  }

  const resultPayload = getOptionalJsonObject(value, "resultPayload", "body");
  const confidence = getOptionalFiniteNumber(value, "confidence", "body");

  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    throw new ApiError(400, "invalid_request", "body.confidence must be between 0 and 1");
  }

  return {
    attemptId: getRequiredString(value, "attemptId", "body"),
    status: status as RepairJobCompleteRequest["status"],
    replicatorHandoffPath: getOptionalString(value, "replicatorHandoffPath", "body"),
    patchSummary: getOptionalString(value, "patchSummary", "body"),
    verificationCommand: getOptionalString(value, "verificationCommand", "body"),
    verificationExitCode: getOptionalFiniteNumber(value, "verificationExitCode", "body"),
    verificationStdout: getOptionalString(value, "verificationStdout", "body"),
    verificationStderr: getOptionalString(value, "verificationStderr", "body"),
    confidence,
    runDirectory: getOptionalString(value, "runDirectory", "body"),
    resultPayload,
    failureReason: getOptionalString(value, "failureReason", "body"),
  };
}

function fallbackCollectorSelection(
  request: CollectorSelectionRequest,
  warnings: string[] = [],
): CollectorSelectionResult {
  const nextCollector =
    request.collectorInventory.find((item) => item.id === "javascript-node-nextjs") ??
    request.collectorInventory.find((item) => item.id === "javascript-node-generic") ??
    request.collectorInventory[0];

  if (!nextCollector) {
    throw new ApiError(
      400,
      "invalid_request",
      "body.collectorInventory must include at least one collector",
    );
  }

  const normalizedFrameworks = new Set(
    request.frameworkCandidates.map((entry) => entry.toLowerCase()),
  );
  const entrypoint =
    request.likelyEntrypoints.find((path) => path.includes("app/layout")) ??
    request.likelyEntrypoints[0];
  const isNext =
    normalizedFrameworks.has("next") ||
    normalizedFrameworks.has("next.js") ||
    nextCollector.id === "javascript-node-nextjs";

  return {
    collectorId: isNext && nextCollector.id !== "javascript-node-nextjs"
      ? "javascript-node-nextjs"
      : nextCollector.id,
    runtime: request.runtimeCandidates[0] ?? "node",
    framework: request.frameworkCandidates[0],
    strategy: nextCollector.installStrategy,
    bootstrapFile: ".aurakeeper/collector.js",
    entrypointPath: entrypoint,
    patchMode: request.autoPatchAllowed && entrypoint ? "auto_patch" : "generate_import_only",
    confidence: isNext ? 0.72 : 0.61,
    reason: isNext
      ? "Fallback selector detected a Next.js-style Node repository."
      : "Fallback selector detected a generic Node.js repository.",
    edits: [".aurakeeper/config.json", ".aurakeeper/collector.js", ".env.local"],
    warnings,
    selectorSource: "fallback",
  };
}

function buildSelectorInstructions(request: CollectorSelectionRequest): string {
  return [
    "You are selecting the safest AuraKeeper collector for a local onboarding workflow.",
    "Choose only from the provided collector inventory.",
    "Prefer the smallest safe integration that can capture local Node.js errors.",
    "Do not invent collectors, files, or unsupported strategies.",
    "Only use patchMode=auto_patch when the entry point is explicit and low-risk.",
    "When uncertain, use patchMode=generate_import_only and explain the risk in warnings.",
    "Return valid JSON that exactly matches the schema.",
    `Repository path: ${request.repoPath}`,
  ].join("\n");
}

async function requestCodexCollectorSelection(
  request: CollectorSelectionRequest,
): Promise<CollectorSelectionResult> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "aurakeeper-selector-"));
  const schemaPath = join(tempDirectory, "collector-selection.schema.json");
  const outputPath = join(tempDirectory, "collector-selection.json");
  const prompt = [
    buildSelectorInstructions(request),
    "",
    "Repository evidence:",
    JSON.stringify(request, null, 2),
  ].join("\n");

  try {
    await writeFile(
      schemaPath,
      JSON.stringify(SELECTOR_SCHEMA.schema, null, 2),
      "utf8",
    );

    await execFile(
      "codex",
      [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "--cd",
        request.repoPath,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        prompt,
      ],
      {
        maxBuffer: 1024 * 1024 * 8,
      },
    );

    const text = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(text) as Omit<CollectorSelectionResult, "selectorSource"> & {
      framework: string | null;
      entrypointPath: string | null;
    };

    return {
      ...parsed,
      framework: parsed.framework ?? undefined,
      entrypointPath: parsed.entrypointPath ?? undefined,
      selectorSource: "codex",
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function selectCollector(
  request: CollectorSelectionRequest,
): Promise<CollectorSelectionResult> {
  try {
    return await requestCodexCollectorSelection(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Collector selection fell back unexpectedly";
    return fallbackCollectorSelection(request, [`Codex selector fallback: ${message}`]);
  }
}

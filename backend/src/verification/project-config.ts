import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  BrowserAutomationRole,
  ExecutionBackendId,
  ExecutionBackendPreference,
  ProjectVerificationConfig,
  TrustLevel,
  VerificationEnvironment,
  VerificationSuite,
} from "./types";

const CONFIG_FILES = [".aurakeeper.json", ".aurakeeper.yml", ".aurakeeper.yaml"];
const BACKENDS = new Set(["docker", "local"]);
const BACKEND_PREFERENCES = new Set(["docker", "local", "auto"]);
const SUITES = new Set(["targeted", "standard", "fuzz", "full"]);
const TRUST_LEVELS = new Set(["trusted", "untrusted"]);
const ENVIRONMENTS = new Set(["production", "hosted", "local", "development"]);
const BROWSER_ROLES = new Set(["replicator", "tester"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const output = value.filter((entry): entry is string => typeof entry === "string");

  return output.length > 0 ? output : undefined;
}

function asBackendPreference(value: unknown): ExecutionBackendPreference | undefined {
  return typeof value === "string" && BACKEND_PREFERENCES.has(value)
    ? (value as ExecutionBackendPreference)
    : undefined;
}

function asBackendArray(value: unknown): ExecutionBackendId[] | undefined {
  const entries = asStringArray(value)?.filter((entry): entry is ExecutionBackendId =>
    BACKENDS.has(entry)
  );

  return entries && entries.length > 0 ? entries : undefined;
}

function asSuiteArray(value: unknown): VerificationSuite[] | undefined {
  const entries = asStringArray(value)?.filter((entry): entry is VerificationSuite =>
    SUITES.has(entry)
  );

  return entries && entries.length > 0 ? entries : undefined;
}

function asTrustLevel(value: unknown): TrustLevel | undefined {
  return typeof value === "string" && TRUST_LEVELS.has(value)
    ? (value as TrustLevel)
    : undefined;
}

function asEnvironment(value: unknown): VerificationEnvironment | undefined {
  return typeof value === "string" && ENVIRONMENTS.has(value)
    ? (value as VerificationEnvironment)
    : undefined;
}

function asBrowserRoles(value: unknown): BrowserAutomationRole[] | undefined {
  const entries = asStringArray(value)?.filter((entry): entry is BrowserAutomationRole =>
    BROWSER_ROLES.has(entry)
  );

  return entries && entries.length > 0 ? entries : undefined;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => parseScalar(entry));
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  const asNumeric = Number(trimmed);

  if (trimmed !== "" && !Number.isNaN(asNumeric)) {
    return asNumeric;
  }

  return trimmed;
}

function parseKeyValue(line: string): { key: string; value?: unknown } | undefined {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex < 0) {
    return undefined;
  }

  const key = line.slice(0, separatorIndex).trim();
  const rawValue = line.slice(separatorIndex + 1).trim();

  if (!key) {
    return undefined;
  }

  return {
    key,
    value: rawValue.length > 0 ? parseScalar(rawValue) : undefined,
  };
}

function parseSimpleYaml(source: string): unknown {
  const root: Record<string, unknown> = {};
  let currentTopKey: string | undefined;
  let currentNestedKey: string | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");

    if (!withoutComment.trim()) {
      continue;
    }

    const indent = withoutComment.match(/^ */)?.[0].length ?? 0;
    const line = withoutComment.trim();

    if (indent === 0) {
      const parsed = parseKeyValue(line);

      if (!parsed) {
        continue;
      }

      root[parsed.key] = parsed.value ?? {};
      currentTopKey = parsed.key;
      currentNestedKey = undefined;
      continue;
    }

    if (indent === 2 && currentTopKey) {
      if (line.startsWith("- ")) {
        const existing = root[currentTopKey];
        const next = Array.isArray(existing) ? existing : [];
        next.push(parseScalar(line.slice(2)));
        root[currentTopKey] = next;
        continue;
      }

      const parsed = parseKeyValue(line);
      const section = isObject(root[currentTopKey])
        ? (root[currentTopKey] as Record<string, unknown>)
        : {};

      if (parsed) {
        section[parsed.key] = parsed.value ?? [];
        root[currentTopKey] = section;
        currentNestedKey = parsed.key;
      }

      continue;
    }

    if (indent === 4 && currentTopKey && currentNestedKey) {
      const section = isObject(root[currentTopKey])
        ? (root[currentTopKey] as Record<string, unknown>)
        : {};

      if (line.startsWith("- ")) {
        const existing = section[currentNestedKey];
        const next = Array.isArray(existing) ? existing : [];
        next.push(parseScalar(line.slice(2)));
        section[currentNestedKey] = next;
        root[currentTopKey] = section;
      }
    }
  }

  return root;
}

function normalizeCommands(value: unknown): ProjectVerificationConfig["commands"] {
  if (!isObject(value)) {
    return undefined;
  }

  return {
    setup: asStringArray(value.setup),
    targeted: asStringArray(value.targeted),
    standard: asStringArray(value.standard),
    fuzz: asStringArray(value.fuzz),
    full: asStringArray(value.full),
    test: asString(value.test),
    typecheck: asString(value.typecheck),
    lint: asString(value.lint),
    build: asString(value.build),
    replay: asString(value.replay),
  };
}

export function normalizeProjectVerificationConfig(
  value: unknown
): ProjectVerificationConfig {
  if (!isObject(value)) {
    return {};
  }

  const execution = isObject(value.execution)
    ? {
        preferredBackend: asBackendPreference(value.execution.preferredBackend),
        allowedBackends: asBackendArray(value.execution.allowedBackends),
        trustLevel: asTrustLevel(value.execution.trustLevel),
        environment: asEnvironment(value.execution.environment),
        requiresDocker: asBoolean(value.execution.requiresDocker),
      }
    : undefined;

  const limits = isObject(value.limits)
    ? {
        commandTimeoutMs: asNumber(value.limits.commandTimeoutMs),
        setupTimeoutMs: asNumber(value.limits.setupTimeoutMs),
        fuzzTimeoutMs: asNumber(value.limits.fuzzTimeoutMs),
        cpus: asNumber(value.limits.cpus),
        memory: asString(value.limits.memory),
      }
    : undefined;

  const docker = isObject(value.docker)
    ? {
        image: asString(value.docker.image),
        networkDuringSetup: asBoolean(value.docker.networkDuringSetup),
      }
    : undefined;

  const local = isObject(value.local)
    ? {
        keepWorkspace: asBoolean(value.local.keepWorkspace),
      }
    : undefined;

  const browser = isObject(value.browser)
    ? {
        enabled: asBoolean(value.browser.enabled),
        roles: asBrowserRoles(value.browser.roles),
        command: asString(value.browser.command),
        configPath: asString(value.browser.configPath),
        remoteProvider: asString(value.browser.remoteProvider),
        headed: asBoolean(value.browser.headed),
        sessionName: asString(value.browser.sessionName),
        startupCommand: asString(value.browser.startupCommand),
        startupCwd: asString(value.browser.startupCwd),
        startupTimeoutMs: asNumber(value.browser.startupTimeoutMs),
        targetUrl: asString(value.browser.targetUrl),
        healthcheckUrl: asString(value.browser.healthcheckUrl),
        waitForUrl: asString(value.browser.waitForUrl),
        allowedDomains: asStringArray(value.browser.allowedDomains),
      }
    : undefined;

  return {
    execution,
    profiles: asStringArray(value.profiles),
    projectRoots: asStringArray(value.projectRoots),
    suites: asSuiteArray(value.suites),
    commands: normalizeCommands(value.commands),
    browser,
    allowedCommandPrefixes: asStringArray(value.allowedCommandPrefixes),
    allowedPaths: asStringArray(value.allowedPaths),
    limits,
    docker,
    local,
  };
}

export async function loadProjectVerificationConfig(
  projectRoot: string
): Promise<ProjectVerificationConfig> {
  for (const fileName of CONFIG_FILES) {
    const filePath = join(projectRoot, fileName);

    try {
      const source = await readFile(filePath, "utf8");
      const parsed = fileName.endsWith(".json")
        ? JSON.parse(source)
        : parseSimpleYaml(source);

      return normalizeProjectVerificationConfig(parsed);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {};
}

import type { Dirent } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import type { ErrorLogRequest } from "../validation";
import { checkDockerAvailable } from "./commands";
import { loadProjectVerificationConfig } from "./project-config";
import { selectTechnologyProfile } from "./profiles";
import {
  applyPatchToCheckout,
  cleanupWorkspace,
  createArtifactsDir,
  prepareWorkspace,
} from "./workspace";
import type {
  BackendSelectionDecision,
  BackendSelectionInput,
  BrowserAutomationCapability,
  BrowserAutomationRole,
  ExecutionBackendId,
  ExecutionBackendPreference,
  ProjectVerificationConfig,
  RepairPatchPromotionMode,
  TechnologyProfile,
  TrustLevel,
  VerificationEnvironment,
  VerificationRunReport,
  VerificationRunRequest,
  VerificationStatus,
  VerificationSuite,
} from "./types";

const DEFAULT_BACKENDS: ExecutionBackendId[] = ["docker", "local"];
const DEFAULT_SUITES: VerificationSuite[] = ["targeted", "standard", "fuzz"];
const MAX_FILE_TREE_ENTRIES = 800;
const MAX_PROJECT_DOCUMENTS = 40;
const MAX_RELEVANT_FILES = 12;
const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
const AGENT_ROLES = ["replicator", "worker", "tester"] as const;
const FILE_REFERENCE_REGEX =
  /((?:[A-Za-z]:)?(?:[./\\]|\/)?(?:[\w@.-]+[\/\\])+[\w@. -]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|php|rs|swift|vue|svelte)(?::\d+){0,2})/g;

const EXCLUDED_CONTEXT_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "__pycache__",
]);

const PROJECT_DOCUMENT_NAMES = new Set([
  ".aurakeeper.json",
  ".aurakeeper.yaml",
  ".aurakeeper.yml",
  "AGENTS.md",
  "Cargo.toml",
  "README.md",
  "go.mod",
  "openapi.yaml",
  "openapi.yml",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
]);
const DEFAULT_BROWSER_ROLES: BrowserAutomationRole[] = ["replicator", "tester"];
const FRONTEND_PLATFORMS = new Set(["web", "frontend", "browser"]);
const FRONTEND_FRAMEWORK_HINTS = ["react", "next", "vue", "nuxt", "svelte", "angular", "remix"];
const AGENT_BROWSER_DOCS_URL = "https://agent-browser.dev/";

export type AgentRole = (typeof AGENT_ROLES)[number];
export type StructuredErrorEvent = ErrorLogRequest | Record<string, unknown>;

export type CodebaseDocument = {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

export type CodebaseContext = {
  rootPath: string;
  profile: {
    id: string;
    displayName: string;
    defaultDockerImage: string;
  };
  projectConfig: ProjectVerificationConfig;
  fileTree: string[];
  fileTreeTruncated: boolean;
  instructions: CodebaseDocument[];
  contracts: CodebaseDocument[];
  projectDocuments: CodebaseDocument[];
  relevantFiles: CodebaseDocument[];
  limits: {
    maxFileTreeEntries: number;
    maxProjectDocuments: number;
    maxRelevantFiles: number;
    maxContextFileBytes: number;
  };
};

export type CodebaseContextInput = {
  rootPath: string;
  projectConfig?: ProjectVerificationConfig;
  profile?: TechnologyProfile;
  error?: unknown;
};

export type AgentPromptSpec = {
  role: AgentRole;
  path: string;
  content: string;
};

export type AgentPromptSet = Record<AgentRole, AgentPromptSpec>;

export type SandboxPolicy = {
  selectedBackend: ExecutionBackendId;
  backendReason: string;
  backendFallback: boolean;
  dockerAvailable: boolean;
  dockerImage: string;
  environment: VerificationEnvironment;
  trustLevel: TrustLevel;
  suites: VerificationSuite[];
};

export type AgentCapabilities = {
  browser?: BrowserAutomationCapability;
};

export type AgentTask<TInput> = {
  id: string;
  role: AgentRole;
  repairAttemptId: string;
  prompt: AgentPromptSpec;
  repository: VerificationRunRequest["repository"];
  codebase: CodebaseContext;
  sandbox: SandboxPolicy;
  capabilities?: AgentCapabilities;
  input: TInput;
  artifactsDir: string;
  createdAt: string;
};

export type AgentResult<TOutput> = {
  output: TOutput;
  artifacts?: string[];
  raw?: unknown;
};

export type RepairAgentClient = {
  run<TInput, TOutput>(task: AgentTask<TInput>): Promise<AgentResult<TOutput>>;
};

export type AgentCommandLog = {
  command: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  notes?: string;
};

export type ReplicatorAgentInput = {
  error: StructuredErrorEvent;
  issueSummary?: string;
  projectConfig: ProjectVerificationConfig;
};

export type ReplicatorAgentOutput = {
  status: "reproduced" | "not_reproduced" | "needs_context";
  handoff?: string;
  handoffPath?: string;
  tldr?: string;
  likelyCause?: string;
  reproductionCommands?: string[];
  commandsRun?: AgentCommandLog[];
  affectedFiles?: string[];
  confidence?: string;
  remainingUncertainty?: string;
};

export type WorkerAgentInput = {
  error: StructuredErrorEvent;
  issueSummary?: string;
  replicator: ReplicatorAgentOutput;
};

export type WorkerAgentOutput = {
  status: "patched" | "blocked" | "needs_context";
  issueSummary?: string;
  suspectedRootCause?: string;
  filesChanged?: string[];
  locChanged?: number;
  patch?: string;
  verificationCommands?: AgentCommandLog[];
  confidence?: string;
  remainingRisk?: string;
};

export type TesterAgentInput = {
  error: StructuredErrorEvent;
  issueSummary?: string;
  selectedBackend: ExecutionBackendId;
  profileId: string;
  suites: VerificationSuite[];
  replicator: ReplicatorAgentOutput;
  worker: WorkerAgentOutput;
  verificationReport: VerificationRunReport;
};

export type TesterAgentOutput = {
  status: VerificationStatus;
  prGate: "allow" | "block";
  originalIssueVerification?: string;
  regressionSummary?: string;
  commandsReviewed?: string[];
  skippedSuites?: Array<{ suite: VerificationSuite; reason: string }>;
  artifactsReviewed?: string[];
  confidence?: string;
  remainingRisk?: string;
};

export type AgentRunRecord<TOutput> = {
  role: AgentRole;
  promptPath: string;
  taskPath: string;
  resultPath: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  output?: TOutput;
  artifacts?: string[];
  raw?: unknown;
  error?: string;
};

export type RepairOrchestrationRequest = {
  repairAttemptId?: string;
  repository: VerificationRunRequest["repository"];
  error: StructuredErrorEvent;
  issueSummary?: string;
  suites?: VerificationSuite[];
  backend?: ExecutionBackendPreference;
  environment?: VerificationEnvironment;
  trustLevel?: TrustLevel;
  promotionMode?: RepairPatchPromotionMode;
  config?: ProjectVerificationConfig;
  artifactsDir?: string;
  keepWorkspace?: boolean;
  dockerAvailable?: boolean;
};

export type RepairOrchestrationOptions = {
  agentPromptDir?: string;
  browserCommandAvailable?: (command: string) => Promise<boolean>;
  onStageChange?: (update: {
    repairAttemptId: string;
    stage: RepairOrchestrationReport["stage"];
    detail: string;
    selectedBackend?: ExecutionBackendId;
    profileId?: string;
  }) => void | Promise<void>;
};

export type RepairOrchestrationReport = {
  repairAttemptId: string;
  status: VerificationStatus;
  prGate: "allow" | "block";
  stage:
    | "backend_selection"
    | "context"
    | "replicator"
    | "worker"
    | "verification"
    | "tester"
    | "promotion"
    | "complete";
  selectedBackend?: ExecutionBackendId;
  backendReason: string;
  backendFallback: boolean;
  profileId?: string;
  suitesRequested: VerificationSuite[];
  artifactsDir: string;
  codebaseContextPath?: string;
  agents: {
    replicator?: AgentRunRecord<ReplicatorAgentOutput>;
    worker?: AgentRunRecord<WorkerAgentOutput>;
    tester?: AgentRunRecord<TesterAgentOutput>;
  };
  verification?: VerificationRunReport;
  failureReason?: string;
  startedAt: string;
  finishedAt: string;
};

function includesBackend(
  backends: ExecutionBackendId[],
  backend: ExecutionBackendId
): boolean {
  return backends.includes(backend);
}

function isDockerPreferredEnvironment(environment: VerificationEnvironment): boolean {
  return environment === "production" || environment === "hosted";
}

function choosePreferredBackend(input: BackendSelectionInput): ExecutionBackendId {
  if (input.requestedBackend && input.requestedBackend !== "auto") {
    return input.requestedBackend;
  }

  const configured = input.config?.execution?.preferredBackend;

  if (configured && configured !== "auto") {
    return configured;
  }

  const environment =
    input.environment ?? input.config?.execution?.environment ?? "production";
  const trustLevel = input.trustLevel ?? input.config?.execution?.trustLevel ?? "untrusted";

  if (input.config?.execution?.requiresDocker) {
    return "docker";
  }

  if (isDockerPreferredEnvironment(environment) || trustLevel === "untrusted") {
    return "docker";
  }

  return "local";
}

function isBackendAvailable(backend: ExecutionBackendId, dockerAvailable: boolean): boolean {
  if (backend === "docker") {
    return dockerAvailable;
  }

  return true;
}

export function selectExecutionBackend(
  input: BackendSelectionInput
): BackendSelectionDecision {
  const allowedBackends = input.config?.execution?.allowedBackends ?? DEFAULT_BACKENDS;
  const preferred = choosePreferredBackend(input);
  const trustLevel = input.trustLevel ?? input.config?.execution?.trustLevel ?? "untrusted";

  if (!includesBackend(allowedBackends, preferred)) {
    return {
      status: "blocked",
      reason: `Preferred backend '${preferred}' is not allowed by project policy.`,
      fallback: false,
    };
  }

  if (isBackendAvailable(preferred, input.dockerAvailable)) {
    return {
      status: "selected",
      backend: preferred,
      reason: `Selected '${preferred}' from orchestrator policy.`,
      fallback: false,
    };
  }

  if (
    preferred === "docker" &&
    trustLevel === "trusted" &&
    includesBackend(allowedBackends, "local")
  ) {
    return {
      status: "selected",
      backend: "local",
      reason:
        "Docker is unavailable, project is trusted, and local execution is allowed.",
      fallback: true,
    };
  }

  return {
    status: "blocked",
    reason:
      preferred === "docker"
        ? "Docker is unavailable and no safe fallback is allowed."
        : `Preferred backend '${preferred}' is unavailable.`,
    fallback: false,
  };
}

function createRepairAttemptId(): string {
  return `repair_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function uniqueSuites(suites: VerificationSuite[]): VerificationSuite[] {
  return suites.filter((suite, index) => suites.indexOf(suite) === index);
}

function requestedSuites(
  request: RepairOrchestrationRequest,
  config: ProjectVerificationConfig
): VerificationSuite[] {
  return uniqueSuites(request.suites ?? config.suites ?? DEFAULT_SUITES);
}

function mergeProjectVerificationConfig(
  loadedConfig: ProjectVerificationConfig,
  requestConfig: ProjectVerificationConfig | undefined
): ProjectVerificationConfig {
  return {
    ...loadedConfig,
    ...requestConfig,
    execution: {
      ...loadedConfig.execution,
      ...requestConfig?.execution,
    },
    commands: {
      ...loadedConfig.commands,
      ...requestConfig?.commands,
    },
    browser: {
      ...loadedConfig.browser,
      ...requestConfig?.browser,
    },
    limits: {
      ...loadedConfig.limits,
      ...requestConfig?.limits,
    },
    docker: {
      ...loadedConfig.docker,
      ...requestConfig?.docker,
    },
    local: {
      ...loadedConfig.local,
      ...requestConfig?.local,
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function browserRoles(config: ProjectVerificationConfig): BrowserAutomationRole[] {
  return config.browser?.roles?.filter((role, index, roles) => roles.indexOf(role) === index) ??
    DEFAULT_BROWSER_ROLES;
}

function looksLikeFrontendError(error: StructuredErrorEvent): boolean {
  const platform = nestedString(error, ["platform"])?.toLowerCase();

  if (platform && FRONTEND_PLATFORMS.has(platform)) {
    return true;
  }

  const framework = nestedString(error, ["source", "framework"])?.toLowerCase();

  if (framework && FRONTEND_FRAMEWORK_HINTS.some((hint) => framework.includes(hint))) {
    return true;
  }

  return Boolean(
    nestedString(error, ["context", "request", "url"]) ||
      nestedString(error, ["context", "request", "origin"]) ||
      nestedString(error, ["error", "details", "url"])
  );
}

function browserTargetUrl(
  error: StructuredErrorEvent,
  config: ProjectVerificationConfig
): string | undefined {
  const configured = config.browser?.targetUrl;

  if (configured) {
    return configured;
  }

  const candidates = [
    nestedString(error, ["context", "request", "url"]),
    nestedString(error, ["error", "details", "url"]),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return new URL(candidate).toString();
    } catch {
      continue;
    }
  }

  const origin = nestedString(error, ["context", "request", "origin"]);
  const path = nestedString(error, ["context", "request", "path"]);

  if (!origin || !path) {
    return undefined;
  }

  try {
    return new URL(path, origin).toString();
  } catch {
    return undefined;
  }
}

function browserAllowedDomains(
  targetUrl: string | undefined,
  config: ProjectVerificationConfig
): string[] | undefined {
  if (config.browser?.allowedDomains?.length) {
    return config.browser.allowedDomains;
  }

  if (!targetUrl) {
    return undefined;
  }

  try {
    return [new URL(targetUrl).hostname];
  } catch {
    return undefined;
  }
}

async function browserConfigPath(
  rootPath: string,
  config: ProjectVerificationConfig
): Promise<string | undefined> {
  if (config.browser?.configPath) {
    return resolve(rootPath, config.browser.configPath);
  }

  const discovered = resolve(rootPath, "agent-browser.json");

  return (await pathExists(discovered)) ? discovered : undefined;
}

async function defaultBrowserCommandAvailable(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `${command} --help >/dev/null 2>&1`], {
      stdio: "ignore",
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, 3000);

    child.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

function localhostBrowserTarget(targetUrl: string | undefined): "127.0.0.1" | "localhost" | undefined {
  if (!targetUrl) {
    return undefined;
  }

  try {
    const hostname = new URL(targetUrl).hostname;

    if (hostname === "127.0.0.1" || hostname === "localhost") {
      return hostname;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function normalizeBrowserStartupCommand(
  startupCommand: string | undefined,
  targetUrl: string | undefined
): string | undefined {
  if (!startupCommand) {
    return undefined;
  }

  const hostname = localhostBrowserTarget(targetUrl);

  if (!hostname) {
    return startupCommand;
  }

  const normalized = startupCommand.trim();

  if (
    normalized.includes("--hostname") ||
    normalized.includes("--host") ||
    normalized.startsWith("HOST=")
  ) {
    return normalized;
  }

  if (/(?:^|\s)next\s+dev(?:\s|$)/.test(normalized)) {
    return `${normalized} --hostname ${hostname}`;
  }

  if (
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev(?:\s|$)/.test(normalized) ||
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?start(?:\s|$)/.test(normalized)
  ) {
    return normalized.includes(" -- ")
      ? `${normalized} --hostname ${hostname}`
      : `${normalized} -- --hostname ${hostname}`;
  }

  return normalized;
}

async function browserCapabilityForRole(input: {
  role: BrowserAutomationRole;
  rootPath: string;
  workspacePath: string;
  artifactsDir: string;
  error: StructuredErrorEvent;
  config: ProjectVerificationConfig;
  commandAvailable?: (command: string) => Promise<boolean>;
}): Promise<BrowserAutomationCapability | undefined> {
  if (input.config.browser?.enabled === false) {
    return undefined;
  }

  if (!browserRoles(input.config).includes(input.role)) {
    return undefined;
  }

  if (!looksLikeFrontendError(input.error)) {
    return undefined;
  }

  const targetUrl = browserTargetUrl(input.error, input.config);
  const command = input.config.browser?.command ?? "agent-browser";

  if (!(await (input.commandAvailable ?? defaultBrowserCommandAvailable)(command))) {
    return undefined;
  }

  const startupCommand = normalizeBrowserStartupCommand(
    input.config.browser?.startupCommand,
    targetUrl
  );

  return {
    provider: "agent-browser",
    command,
    docsUrl: AGENT_BROWSER_DOCS_URL,
    configPath: await browserConfigPath(input.rootPath, input.config),
    remoteProvider: input.config.browser?.remoteProvider,
    headed: input.config.browser?.headed,
    sessionName: input.config.browser?.sessionName,
    startupCommand,
    startupCwd: resolve(input.workspacePath, input.config.browser?.startupCwd ?? "."),
    startupTimeoutMs: input.config.browser?.startupTimeoutMs,
    targetUrl,
    healthcheckUrl: input.config.browser?.healthcheckUrl,
    waitForUrl: input.config.browser?.waitForUrl,
    allowedDomains: browserAllowedDomains(targetUrl, input.config),
    workspacePath: input.workspacePath,
    screenshotDir: input.artifactsDir,
    requiredScreenshots:
      input.role === "replicator"
        ? ["replicator-browser-current.png"]
        : ["tester-browser-before-fix.png", "tester-browser-after-fix.png"],
    recommendedWorkflow: [
      `The browser capability is a shell command, not a built-in Codex tool. Run \`${command}\` directly from the terminal.`,
      "Start the frontend app if a startupCommand is provided, then wait until the app is reachable.",
      `Open the target URL with \`${command} open <url>\`, then inspect refs with \`${command} snapshot -i --json\`.`,
      `Interact with refs using commands such as \`${command} click @e1\` or \`${command} fill @e2 "text"\`, then re-snapshot after each meaningful UI change.`,
      "Save the required screenshots into screenshotDir using the listed filenames so they are preserved with the run artifacts.",
    ],
  };
}

async function cleanupVerificationWorkspace(workspacePath: string | undefined): Promise<void> {
  if (!workspacePath) {
    return;
  }

  await rm(workspacePath, { recursive: true, force: true });
  await rm(dirname(workspacePath), { recursive: true, force: true });
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function shouldWalkEntry(entryName: string): boolean {
  return !EXCLUDED_CONTEXT_NAMES.has(entryName);
}

async function collectFileTree(rootPath: string): Promise<{
  files: string[];
  truncated: boolean;
}> {
  const files: string[] = [];
  const pending = [""];
  let truncated = false;

  while (pending.length > 0) {
    const current = pending.shift() as string;
    const directoryPath = join(rootPath, current);
    let entries: Dirent[];

    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!shouldWalkEntry(entry.name)) {
        continue;
      }

      const relativePath = current ? join(current, entry.name) : entry.name;

      if (entry.isDirectory()) {
        pending.push(relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(normalizeRelativePath(relativePath));

      if (files.length >= MAX_FILE_TREE_ENTRIES) {
        truncated = true;
        return { files, truncated };
      }
    }
  }

  return { files, truncated };
}

async function readContextDocument(
  rootPath: string,
  relativePath: string
): Promise<CodebaseDocument | undefined> {
  const absolutePath = resolve(rootPath, relativePath);

  try {
    const stats = await stat(absolutePath);

    if (!stats.isFile()) {
      return undefined;
    }

    const content = await readFile(absolutePath, "utf8");
    const bytes = Buffer.byteLength(content);

    return {
      path: relativePath,
      content:
        bytes > MAX_CONTEXT_FILE_BYTES
          ? content.slice(0, MAX_CONTEXT_FILE_BYTES)
          : content,
      bytes,
      truncated: bytes > MAX_CONTEXT_FILE_BYTES,
    };
  } catch {
    return undefined;
  }
}

async function readContextDocuments(
  rootPath: string,
  filePaths: string[]
): Promise<CodebaseDocument[]> {
  const documents: CodebaseDocument[] = [];

  for (const filePath of filePaths) {
    const document = await readContextDocument(rootPath, filePath);

    if (document) {
      documents.push(document);
    }
  }

  return documents;
}

function projectDocumentPaths(fileTree: string[]): string[] {
  return fileTree
    .filter((filePath) => PROJECT_DOCUMENT_NAMES.has(basename(filePath)))
    .slice(0, MAX_PROJECT_DOCUMENTS);
}

function directRelativePath(
  rootPath: string,
  candidate: string,
  fileTree: string[]
): string | undefined {
  const cleaned = candidate
    .replace(/^file:\/\//, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replaceAll("\\", "/");

  const resolved = isAbsolute(cleaned) ? cleaned : resolve(rootPath, cleaned);
  const relativePath = normalizeRelativePath(relative(rootPath, resolved));

  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath) &&
    fileTree.includes(relativePath)
  ) {
    return relativePath;
  }

  const stripped = cleaned.replace(/^\.?\//, "");

  return fileTree.find(
    (filePath) => filePath === stripped || cleaned.endsWith(`/${filePath}`)
  );
}

function stringifyForSearch(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function relevantFilePathsFromError(
  rootPath: string,
  error: unknown,
  fileTree: string[]
): string[] {
  const source = stringifyForSearch(error);
  const matches = new Set<string>();

  for (const match of source.matchAll(FILE_REFERENCE_REGEX)) {
    const filePath = directRelativePath(rootPath, match[1], fileTree);

    if (filePath) {
      matches.add(filePath);
    }

    if (matches.size >= MAX_RELEVANT_FILES) {
      break;
    }
  }

  return [...matches];
}

export async function buildCodebaseContext(
  input: CodebaseContextInput
): Promise<CodebaseContext> {
  const rootPath = resolve(input.rootPath);
  const projectConfig =
    input.projectConfig ?? (await loadProjectVerificationConfig(rootPath));
  const profile =
    input.profile ?? (await selectTechnologyProfile(rootPath, projectConfig.profiles));
  const fileTree = await collectFileTree(rootPath);
  const documents = await readContextDocuments(rootPath, projectDocumentPaths(fileTree.files));
  const relevantFiles = await readContextDocuments(
    rootPath,
    relevantFilePathsFromError(rootPath, input.error, fileTree.files)
  );

  return {
    rootPath,
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      defaultDockerImage: profile.defaultDockerImage,
    },
    projectConfig,
    fileTree: fileTree.files,
    fileTreeTruncated: fileTree.truncated,
    instructions: documents.filter((document) => basename(document.path) === "AGENTS.md"),
    contracts: documents.filter((document) =>
      ["openapi.yaml", "openapi.yml"].includes(basename(document.path))
    ),
    projectDocuments: documents,
    relevantFiles,
    limits: {
      maxFileTreeEntries: MAX_FILE_TREE_ENTRIES,
      maxProjectDocuments: MAX_PROJECT_DOCUMENTS,
      maxRelevantFiles: MAX_RELEVANT_FILES,
      maxContextFileBytes: MAX_CONTEXT_FILE_BYTES,
    },
  };
}

function defaultAgentPromptDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "agents");
}

export async function loadAgentPromptSet(
  promptDir = defaultAgentPromptDir()
): Promise<AgentPromptSet> {
  const prompts = {} as AgentPromptSet;

  for (const role of AGENT_ROLES) {
    const promptPath = resolve(promptDir, `${role}.md`);
    prompts[role] = {
      role,
      path: promptPath,
      content: await readFile(promptPath, "utf8"),
    };
  }

  return prompts;
}

async function writeJsonArtifact(
  artifactsDir: string,
  fileName: string,
  value: unknown
): Promise<string> {
  const filePath = join(artifactsDir, fileName);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function executeAgent<TInput, TOutput>(input: {
  role: AgentRole;
  prompt: AgentPromptSpec;
  repairAttemptId: string;
  repository: VerificationRunRequest["repository"];
  codebase: CodebaseContext;
  sandbox: SandboxPolicy;
  capabilities?: AgentCapabilities;
  agentInput: TInput;
  artifactsDir: string;
  agentClient: RepairAgentClient;
}): Promise<AgentRunRecord<TOutput>> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const task: AgentTask<TInput> = {
    id: `${input.repairAttemptId}:${input.role}`,
    role: input.role,
    repairAttemptId: input.repairAttemptId,
    prompt: input.prompt,
    repository: input.repository,
    codebase: input.codebase,
    sandbox: input.sandbox,
    capabilities: input.capabilities,
    input: input.agentInput,
    artifactsDir: input.artifactsDir,
    createdAt: startedAt,
  };
  const taskPath = await writeJsonArtifact(
    input.artifactsDir,
    `agent-task-${input.role}.json`,
    task
  );
  const resultPath = join(input.artifactsDir, `agent-result-${input.role}.json`);

  try {
    const result = await input.agentClient.run<TInput, TOutput>(task);
    const record: AgentRunRecord<TOutput> = {
      role: input.role,
      promptPath: input.prompt.path,
      taskPath,
      resultPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      output: result.output,
      artifacts: result.artifacts,
      raw: result.raw,
    };

    await writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } catch (error) {
    const record: AgentRunRecord<TOutput> = {
      role: input.role,
      promptPath: input.prompt.path,
      taskPath,
      resultPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      error: errorMessage(error),
    };

    await writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }
}

function reproductionCommands(output: ReplicatorAgentOutput): string[] | undefined {
  if (output.reproductionCommands?.length) {
    return output.reproductionCommands;
  }

  const commands = output.commandsRun
    ?.map((entry) => entry.command)
    .filter((command) => command.length > 0);

  return commands && commands.length > 0 ? commands : undefined;
}

function reportFromBase(input: {
  repairAttemptId: string;
  status: VerificationStatus;
  prGate: "allow" | "block";
  stage: RepairOrchestrationReport["stage"];
  backendReason: string;
  backendFallback: boolean;
  suites: VerificationSuite[];
  artifactsDir: string;
  startedAt: string;
  selectedBackend?: ExecutionBackendId;
  profileId?: string;
  codebaseContextPath?: string;
  agents?: RepairOrchestrationReport["agents"];
  verification?: VerificationRunReport;
  failureReason?: string;
}): RepairOrchestrationReport {
  return {
    repairAttemptId: input.repairAttemptId,
    status: input.status,
    prGate: input.prGate,
    stage: input.stage,
    selectedBackend: input.selectedBackend,
    backendReason: input.backendReason,
    backendFallback: input.backendFallback,
    profileId: input.profileId,
    suitesRequested: input.suites,
    artifactsDir: input.artifactsDir,
    codebaseContextPath: input.codebaseContextPath,
    agents: input.agents ?? {},
    verification: input.verification,
    failureReason: input.failureReason,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
  };
}

async function writeOrchestrationReport(
  report: RepairOrchestrationReport
): Promise<RepairOrchestrationReport> {
  await writeJsonArtifact(report.artifactsDir, "orchestrator-report.json", report);
  return report;
}

async function notifyStageChange(
  options: RepairOrchestrationOptions,
  update: {
    repairAttemptId: string;
    stage: RepairOrchestrationReport["stage"];
    detail: string;
    selectedBackend?: ExecutionBackendId;
    profileId?: string;
  }
): Promise<void> {
  await options.onStageChange?.(update);
}

function finalStatusFromTester(
  tester: TesterAgentOutput,
  verification: VerificationRunReport
): {
  status: VerificationStatus;
  prGate: "allow" | "block";
  failureReason?: string;
} {
  if (verification.prGate === "block" && tester.prGate === "allow") {
    return {
      status: verification.status,
      prGate: "block",
      failureReason:
        "Tester requested allow, but verification runner blocked the patch.",
    };
  }

  return {
    status: tester.status,
    prGate: tester.prGate,
  };
}

export async function orchestrateRepair(
  request: RepairOrchestrationRequest,
  agentClient: RepairAgentClient,
  options: RepairOrchestrationOptions = {}
): Promise<RepairOrchestrationReport> {
  const startedAt = new Date().toISOString();
  const repairAttemptId = request.repairAttemptId ?? createRepairAttemptId();
  const sourceRoot = resolve(request.repository.checkoutPath);
  const loadedConfig = await loadProjectVerificationConfig(sourceRoot);
  const config = mergeProjectVerificationConfig(loadedConfig, request.config);
  const artifactsDir = await createArtifactsDir(request.artifactsDir);
  const suites = requestedSuites(request, config);
  const dockerAvailable = request.dockerAvailable ?? (await checkDockerAvailable());
  const environment =
    request.environment ?? config.execution?.environment ?? "production";
  const trustLevel = request.trustLevel ?? config.execution?.trustLevel ?? "untrusted";
  const selection = selectExecutionBackend({
    requestedBackend: request.backend,
    config,
    environment,
    trustLevel,
    dockerAvailable,
    requiredSuites: suites,
  });

  if (selection.status === "blocked") {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "backend_selection",
      detail: selection.reason,
    });
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "backend_selection",
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        suites,
        artifactsDir,
        startedAt,
        failureReason: selection.reason,
      })
    );
  }

  let profile: TechnologyProfile | undefined;
  let codebase: CodebaseContext | undefined;
  let codebaseContextPath: string | undefined;
  let prompts: AgentPromptSet | undefined;

  try {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "context",
      detail: "Preparing codebase context and loading agent prompts.",
      selectedBackend: selection.backend,
    });
    profile = await selectTechnologyProfile(sourceRoot, config.profiles);
    codebase = await buildCodebaseContext({
      rootPath: sourceRoot,
      projectConfig: config,
      profile,
      error: request.error,
    });
    codebaseContextPath = await writeJsonArtifact(
      artifactsDir,
      "codebase-context.json",
      codebase
    );
    prompts = await loadAgentPromptSet(options.agentPromptDir);
  } catch (error) {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "context",
      detail: errorMessage(error),
      selectedBackend: selection.backend,
      profileId: profile?.id,
    });
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "context",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile?.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        startedAt,
        failureReason: errorMessage(error),
      })
    );
  }

  if (!profile || !codebase || !prompts) {
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "context",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile?.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        startedAt,
        failureReason: "Orchestrator could not build the codebase context.",
      })
    );
  }

  const sandbox: SandboxPolicy = {
    selectedBackend: selection.backend,
    backendReason: selection.reason,
    backendFallback: selection.fallback,
    dockerAvailable,
    dockerImage: config.docker?.image ?? profile.defaultDockerImage,
    environment,
    trustLevel,
    suites,
  };
  const agents: RepairOrchestrationReport["agents"] = {};
  const replicatorBrowser = await browserCapabilityForRole({
    role: "replicator",
    rootPath: sourceRoot,
    workspacePath: sourceRoot,
    artifactsDir,
    error: request.error,
    config,
    commandAvailable: options.browserCommandAvailable,
  });
  await notifyStageChange(options, {
    repairAttemptId,
    stage: "replicator",
    detail: "Replicator is reproducing and narrowing the failing path.",
    selectedBackend: selection.backend,
    profileId: profile.id,
  });

  agents.replicator = await executeAgent<ReplicatorAgentInput, ReplicatorAgentOutput>({
    role: "replicator",
    prompt: prompts.replicator,
    repairAttemptId,
    repository: request.repository,
    codebase,
    sandbox,
    capabilities: replicatorBrowser ? { browser: replicatorBrowser } : undefined,
    artifactsDir,
    agentClient,
    agentInput: {
      error: request.error,
      issueSummary: request.issueSummary,
      projectConfig: config,
    },
  });

  if (agents.replicator.error || !agents.replicator.output) {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "replicator",
      detail: agents.replicator.error ?? "Replicator did not return a usable result.",
      selectedBackend: selection.backend,
      profileId: profile.id,
    });
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "replicator",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        agents,
        startedAt,
        failureReason:
          agents.replicator.error ?? "Replicator did not return a usable result.",
      })
    );
  }

  if (agents.replicator.output.status === "needs_context") {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "replicator",
      detail: "Replicator needs more context before a safe fix can start.",
      selectedBackend: selection.backend,
      profileId: profile.id,
    });
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "replicator",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        agents,
        startedAt,
        failureReason: "Replicator needs more context before a safe fix can start.",
      })
    );
  }

  await notifyStageChange(options, {
    repairAttemptId,
    stage: "worker",
    detail: "Worker is preparing and validating a minimal patch.",
    selectedBackend: selection.backend,
    profileId: profile.id,
  });

  const workerWorkspace = await prepareWorkspace({
    backend: selection.backend,
    request: {
      repairAttemptId,
      repository: request.repository,
    },
    profile,
    config,
    artifactsDir,
  });

  try {
    const workerRepository = {
      ...request.repository,
      checkoutPath: workerWorkspace.workspacePath,
    };
    const workerCodebase = await buildCodebaseContext({
      rootPath: workerWorkspace.workspacePath,
      projectConfig: config,
      profile,
      error: request.error,
    });

    agents.worker = await executeAgent<WorkerAgentInput, WorkerAgentOutput>({
      role: "worker",
      prompt: prompts.worker,
      repairAttemptId,
      repository: workerRepository,
      codebase: workerCodebase,
      sandbox,
      artifactsDir,
      agentClient,
      agentInput: {
        error: request.error,
        issueSummary: request.issueSummary,
        replicator: agents.replicator.output,
      },
    });
  } finally {
    await cleanupWorkspace(workerWorkspace);
  }

  if (agents.worker.error || !agents.worker.output) {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "worker",
      detail: agents.worker.error ?? "Worker did not return a usable result.",
      selectedBackend: selection.backend,
      profileId: profile.id,
    });
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "worker",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        agents,
        startedAt,
        failureReason:
          agents.worker.error ?? "Worker did not return a usable result.",
      })
    );
  }

  if (agents.worker.output.status !== "patched" || !agents.worker.output.patch) {
    await notifyStageChange(options, {
      repairAttemptId,
      stage: "worker",
      detail:
        agents.worker.output.status === "needs_context"
          ? "Worker needs more context before producing a safe patch."
          : "Worker did not produce a patch.",
      selectedBackend: selection.backend,
      profileId: profile.id,
    });
    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: "blocked",
        prGate: "block",
        stage: "worker",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        agents,
        startedAt,
        failureReason:
          agents.worker.output.status === "needs_context"
            ? "Worker needs more context before producing a safe patch."
            : "Worker did not produce a patch.",
      })
    );
  }

  const { runVerification, writeVerificationReports } = await import("./runner");
  const keepWorkspaceForTester = true;
  const cleanupVerificationWorkspaceAfterTester =
    !request.keepWorkspace && !config.local?.keepWorkspace;

  await notifyStageChange(options, {
    repairAttemptId,
    stage: "verification",
    detail: "Applying the patch and running verification suites.",
    selectedBackend: selection.backend,
    profileId: profile.id,
  });
  const verification = await runVerification({
    repairAttemptId,
    repository: request.repository,
    patch: agents.worker.output.patch,
    changedFiles: agents.worker.output.filesChanged,
    suites,
    backend: selection.backend,
    environment,
    trustLevel,
    promotionMode: request.promotionMode ?? "auto",
    config,
    artifactsDir,
    keepWorkspace: keepWorkspaceForTester,
    dockerAvailable,
    replicator: {
      handoff: agents.replicator.output.handoff,
      reproductionCommands: reproductionCommands(agents.replicator.output),
    },
  });

  const testerBrowser = await browserCapabilityForRole({
    role: "tester",
    rootPath: sourceRoot,
    workspacePath: verification.workspacePath ?? sourceRoot,
    artifactsDir,
    error: request.error,
    config,
    commandAvailable: options.browserCommandAvailable,
  });

  try {
    const testerRepository = {
      ...request.repository,
      checkoutPath: verification.workspacePath ?? sourceRoot,
    };
    const testerCodebase = await buildCodebaseContext({
      rootPath: testerRepository.checkoutPath,
      projectConfig: config,
      profile,
      error: request.error,
    });

    await notifyStageChange(options, {
      repairAttemptId,
      stage: "tester",
      detail: "Tester is reviewing verification results and regression risk.",
      selectedBackend: selection.backend,
      profileId: profile.id,
    });
    agents.tester = await executeAgent<TesterAgentInput, TesterAgentOutput>({
      role: "tester",
      prompt: prompts.tester,
      repairAttemptId,
      repository: testerRepository,
      codebase: testerCodebase,
      sandbox,
      capabilities: testerBrowser ? { browser: testerBrowser } : undefined,
      artifactsDir,
      agentClient,
      agentInput: {
        error: request.error,
        issueSummary: request.issueSummary,
        selectedBackend: selection.backend,
        profileId: profile.id,
        suites,
        replicator: agents.replicator.output,
        worker: agents.worker.output,
        verificationReport: verification,
      },
    });

    if (agents.tester.error || !agents.tester.output) {
      await notifyStageChange(options, {
        repairAttemptId,
        stage: "tester",
        detail:
          agents.tester.error ??
          verification.failureReason ??
          "Tester did not return a usable result.",
        selectedBackend: selection.backend,
        profileId: profile.id,
      });
      return writeOrchestrationReport(
        reportFromBase({
          repairAttemptId,
          status: verification.status,
          prGate: verification.prGate,
          stage: "tester",
          selectedBackend: selection.backend,
          backendReason: selection.reason,
          backendFallback: selection.fallback,
          profileId: profile.id,
          suites,
          artifactsDir,
          codebaseContextPath,
          agents,
          verification,
          startedAt,
          failureReason:
            agents.tester.error ??
            verification.failureReason ??
            "Tester did not return a usable result.",
        })
      );
    }

    const final = finalStatusFromTester(agents.tester.output, verification);

    if (final.status === "passed" && verification.patchFiles?.original) {
      if ((request.promotionMode ?? "auto") === "auto") {
        await notifyStageChange(options, {
          repairAttemptId,
          stage: "promotion",
          detail: "Verification passed. Applying the patch back to the original checkout.",
          selectedBackend: selection.backend,
          profileId: profile.id,
        });

        const sourcePatchResult = await applyPatchToCheckout({
          checkoutPath: sourceRoot,
          patchFile: join(artifactsDir, verification.patchFiles.original),
          timeoutMs: config.limits?.commandTimeoutMs ?? 60_000,
        });

        if (sourcePatchResult.applied) {
          verification.sourcePatchStatus = "applied";
          verification.sourcePatchAppliedAt = new Date().toISOString();
          verification.sourcePatchError = undefined;
        } else {
          verification.sourcePatchStatus = "failed";
          verification.sourcePatchAppliedAt = undefined;
          verification.sourcePatchError =
            sourcePatchResult.error ?? "Failed to apply the verified patch.";
        }
      }

      await writeVerificationReports(verification);
    }

    const finalFailureReason =
      verification.sourcePatchStatus === "failed"
        ? verification.sourcePatchError ??
          "Verification passed, but applying the patch to the original checkout failed."
        : final.failureReason ?? verification.failureReason;
    const finalStatus =
      verification.sourcePatchStatus === "failed" ? "failed" : final.status;
    const finalPrGate =
      verification.sourcePatchStatus === "failed" ? "block" : final.prGate;

    await notifyStageChange(options, {
      repairAttemptId,
      stage: "complete",
      detail:
        finalStatus === "passed"
          ? verification.sourcePatchStatus === "pending_manual"
            ? "Repair completed. The verified patch is ready for manual apply."
            : "Repair completed and verification passed."
          : finalFailureReason ?? "Repair completed with failures.",
      selectedBackend: selection.backend,
      profileId: profile.id,
    });

    return writeOrchestrationReport(
      reportFromBase({
        repairAttemptId,
        status: finalStatus,
        prGate: finalPrGate,
        stage: "complete",
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile.id,
        suites,
        artifactsDir,
        codebaseContextPath,
        agents,
        verification,
        startedAt,
        failureReason: finalFailureReason,
      })
    );
  } finally {
    if (cleanupVerificationWorkspaceAfterTester) {
      await cleanupVerificationWorkspace(verification.workspacePath);
    }
  }
}

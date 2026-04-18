export type ExecutionBackendId = "docker" | "local";
export type ExecutionBackendPreference = ExecutionBackendId | "auto";
export type VerificationSuite = "targeted" | "standard" | "fuzz" | "full";
export type VerificationStatus = "passed" | "failed" | "blocked" | "inconclusive";
export type TrustLevel = "trusted" | "untrusted";
export type VerificationEnvironment = "production" | "hosted" | "local" | "development";
export type CommandPhase = "setup" | VerificationSuite;
export type CommandSource = "profile" | "config" | "replicator";
export type CommandNetworkMode = "enabled" | "disabled";

export type VerificationCommand = {
  id: string;
  command: string;
  phase: CommandPhase;
  suite?: VerificationSuite;
  source: CommandSource;
  timeoutMs?: number;
  network?: CommandNetworkMode;
  allowFailure?: boolean;
};

export type CommandResult = {
  id: string;
  command: string;
  phase: CommandPhase;
  suite?: VerificationSuite;
  source: CommandSource;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  skipped: boolean;
  skipReason?: string;
};

export type VerificationLimits = {
  commandTimeoutMs?: number;
  setupTimeoutMs?: number;
  fuzzTimeoutMs?: number;
  cpus?: number;
  memory?: string;
};

export type VerificationCommandConfig = {
  setup?: string[];
  targeted?: string[];
  standard?: string[];
  fuzz?: string[];
  full?: string[];
  test?: string;
  typecheck?: string;
  lint?: string;
  build?: string;
  replay?: string;
};

export type ProjectExecutionConfig = {
  preferredBackend?: ExecutionBackendPreference;
  allowedBackends?: ExecutionBackendId[];
  trustLevel?: TrustLevel;
  environment?: VerificationEnvironment;
  requiresDocker?: boolean;
};

export type ProjectDockerConfig = {
  image?: string;
  networkDuringSetup?: boolean;
};

export type ProjectLocalConfig = {
  keepWorkspace?: boolean;
};

export type ProjectVerificationConfig = {
  execution?: ProjectExecutionConfig;
  profiles?: string[];
  projectRoots?: string[];
  suites?: VerificationSuite[];
  commands?: VerificationCommandConfig;
  allowedCommandPrefixes?: string[];
  allowedPaths?: string[];
  limits?: VerificationLimits;
  docker?: ProjectDockerConfig;
  local?: ProjectLocalConfig;
};

export type BackendSelectionInput = {
  requestedBackend?: ExecutionBackendPreference;
  config?: ProjectVerificationConfig;
  environment?: VerificationEnvironment;
  trustLevel?: TrustLevel;
  dockerAvailable: boolean;
  requiredSuites: VerificationSuite[];
};

export type BackendSelectionDecision =
  | {
      status: "selected";
      backend: ExecutionBackendId;
      reason: string;
      fallback: boolean;
    }
  | {
      status: "blocked";
      reason: string;
      fallback: boolean;
    };

export type TechnologyProfileContext = {
  rootPath: string;
  changedFiles: string[];
  selectedSuites: VerificationSuite[];
  config: ProjectVerificationConfig;
};

export type TechnologyProfile = {
  id: string;
  displayName: string;
  defaultDockerImage: string;
  detect(rootPath: string): Promise<number>;
  buildCommands(context: TechnologyProfileContext): Promise<VerificationCommand[]>;
};

export type VerificationRunRequest = {
  repairAttemptId: string;
  repository: {
    checkoutPath: string;
    baseCommit?: string;
    url?: string;
  };
  patch?: string;
  patchFile?: string;
  changedFiles?: string[];
  suites?: VerificationSuite[];
  backend?: ExecutionBackendPreference;
  environment?: VerificationEnvironment;
  trustLevel?: TrustLevel;
  config?: ProjectVerificationConfig;
  artifactsDir?: string;
  keepWorkspace?: boolean;
  dockerAvailable?: boolean;
  replicator?: {
    handoff?: string;
    reproductionCommands?: string[];
  };
};

export type PreparedWorkspace = {
  backend: ExecutionBackendId;
  sourcePath: string;
  workspacePath: string;
  artifactsDir: string;
  keepWorkspace: boolean;
  profile: TechnologyProfile;
  config: ProjectVerificationConfig;
};

export type VerificationRunReport = {
  repairAttemptId: string;
  status: VerificationStatus;
  prGate: "allow" | "block";
  selectedBackend?: ExecutionBackendId;
  backendReason: string;
  backendFallback: boolean;
  profileId?: string;
  suitesRequested: VerificationSuite[];
  suitesRun: VerificationSuite[];
  suitesSkipped: Array<{ suite: VerificationSuite; reason: string }>;
  commands: CommandResult[];
  artifactsDir?: string;
  workspacePath?: string;
  patchApplied: boolean;
  failureReason?: string;
  startedAt: string;
  finishedAt: string;
};

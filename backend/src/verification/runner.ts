import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runBackendCommand } from "./backends";
import { checkDockerAvailable, createSkippedResult } from "./commands";
import { selectExecutionBackend } from "./orchestrator";
import { loadProjectVerificationConfig } from "./project-config";
import { selectTechnologyProfile } from "./profiles";
import {
  applyWorkerPatch,
  cleanupWorkspace,
  createArtifactsDir,
  prepareWorkspace,
} from "./workspace";
import type {
  CommandPhase,
  CommandResult,
  ProjectVerificationConfig,
  VerificationCommand,
  VerificationRunReport,
  VerificationRunRequest,
  VerificationStatus,
  VerificationSuite,
} from "./types";

const DEFAULT_SUITES: VerificationSuite[] = ["targeted", "standard", "fuzz"];
const PHASE_ORDER: Record<CommandPhase, number> = {
  setup: 0,
  targeted: 1,
  standard: 2,
  fuzz: 3,
  full: 4,
};

function uniqueSuites(suites: VerificationSuite[]): VerificationSuite[] {
  return suites.filter((suite, index) => suites.indexOf(suite) === index);
}

function requestedSuites(
  request: VerificationRunRequest,
  config: ProjectVerificationConfig
): VerificationSuite[] {
  return uniqueSuites(request.suites ?? config.suites ?? DEFAULT_SUITES);
}

function commandIsSelected(
  command: VerificationCommand,
  suites: VerificationSuite[]
): boolean {
  if (command.phase === "setup") {
    return true;
  }

  if (suites.includes("full")) {
    return true;
  }

  return command.suite ? suites.includes(command.suite) : false;
}

function timeoutForCommand(
  command: VerificationCommand,
  config: ProjectVerificationConfig
): VerificationCommand {
  if (command.timeoutMs) {
    return command;
  }

  if (command.phase === "setup" && config.limits?.setupTimeoutMs) {
    return {
      ...command,
      timeoutMs: config.limits.setupTimeoutMs,
    };
  }

  if (command.phase === "fuzz" && config.limits?.fuzzTimeoutMs) {
    return {
      ...command,
      timeoutMs: config.limits.fuzzTimeoutMs,
    };
  }

  if (config.limits?.commandTimeoutMs) {
    return {
      ...command,
      timeoutMs: config.limits.commandTimeoutMs,
    };
  }

  return command;
}

function isAllowedCommand(
  command: VerificationCommand,
  config: ProjectVerificationConfig
): boolean {
  const prefixes = config.allowedCommandPrefixes;

  if (!prefixes || prefixes.length === 0) {
    return true;
  }

  return prefixes.some(
    (prefix) => command.command === prefix || command.command.startsWith(`${prefix} `)
  );
}

function changedFilesFromPatch(patch: string | undefined): string[] {
  if (!patch) {
    return [];
  }

  const files = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice("+++ b/".length))
    .filter((filePath) => filePath && filePath !== "/dev/null");

  return files.filter((filePath, index) => files.indexOf(filePath) === index);
}

function replicatorCommands(request: VerificationRunRequest): VerificationCommand[] {
  return (request.replicator?.reproductionCommands ?? []).map((entry, index) => ({
    id: `replicator:targeted:${index + 1}`,
    command: entry,
    phase: "targeted",
    suite: "targeted",
    source: "replicator",
    network: "disabled",
  }));
}

function sortCommands(commands: VerificationCommand[]): VerificationCommand[] {
  return [...commands].sort((left, right) => {
    const phaseDelta = PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase];

    if (phaseDelta !== 0) {
      return phaseDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

function statusFromResults(results: CommandResult[]): {
  status: VerificationStatus;
  failureReason?: string;
} {
  const disallowed = results.find(
    (result) =>
      result.skipped &&
      result.skipReason === "Command is not allowed by project policy."
  );

  if (disallowed) {
    return {
      status: "blocked",
      failureReason: `Command blocked by project policy: ${disallowed.id}`,
    };
  }

  const executed = results.filter((result) => !result.skipped);
  const setupFailure = executed.find(
    (result) => result.phase === "setup" && (result.exitCode !== 0 || result.timedOut)
  );

  if (setupFailure) {
    return {
      status: "blocked",
      failureReason: `Setup command failed: ${setupFailure.id}`,
    };
  }

  const verificationResults = executed.filter((result) => result.phase !== "setup");

  if (verificationResults.length === 0) {
    return {
      status: "inconclusive",
      failureReason: "No verification commands were available for the selected suites.",
    };
  }

  const failure = verificationResults.find(
    (result) => result.exitCode !== 0 || result.timedOut
  );

  if (failure) {
    return {
      status: "failed",
      failureReason:
        failure.phase === "targeted"
          ? `Targeted verification failed: ${failure.id}`
          : `Regression check failed: ${failure.id}`,
    };
  }

  return {
    status: "passed",
  };
}

function suitesRun(results: CommandResult[]): VerificationSuite[] {
  const suites = results
    .filter((result) => !result.skipped && result.phase !== "setup" && result.suite)
    .map((result) => result.suite as VerificationSuite);

  return uniqueSuites(suites);
}

function suitesSkipped(
  suites: VerificationSuite[],
  commands: VerificationCommand[],
  results: CommandResult[]
): Array<{ suite: VerificationSuite; reason: string }> {
  return suites
    .filter((suite) => suite !== "full")
    .filter((suite) => {
      const suiteCommands = commands.filter((command) => command.suite === suite);
      const suiteResults = results.filter((result) => result.suite === suite);

      return suiteCommands.length === 0 || suiteResults.every((result) => result.skipped);
    })
    .map((suite) => ({
      suite,
      reason: "No runnable commands were available for this suite.",
    }));
}

function renderTesterReport(report: VerificationRunReport): string {
  const commands = report.commands
    .map((command) => {
      const status = command.skipped
        ? `skipped: ${command.skipReason}`
        : command.exitCode === 0 && !command.timedOut
          ? "passed"
          : command.timedOut
            ? "timed out"
            : `failed with exit code ${command.exitCode}`;

      return `- ${command.id}: ${status}`;
    })
    .join("\n");

  const skippedSuites = report.suitesSkipped.length
    ? report.suitesSkipped
        .map((suite) => `- ${suite.suite}: ${suite.reason}`)
        .join("\n")
    : "- none";

  return `# Tester Report

Status: ${report.status}
PR gate: ${report.prGate}
Backend: ${report.selectedBackend ?? "none"}
Backend reason: ${report.backendReason}
Profile: ${report.profileId ?? "none"}

## Original Issue Verification

${report.status === "passed" ? "The selected verification commands passed." : report.failureReason ?? "The verification result is inconclusive."}

## Regression Sweep

Suites requested: ${report.suitesRequested.join(", ")}
Suites run: ${report.suitesRun.length ? report.suitesRun.join(", ") : "none"}

## Skipped Suites

${skippedSuites}

## Commands Reviewed

${commands || "- none"}
`;
}

async function writeReports(report: VerificationRunReport): Promise<void> {
  if (!report.artifactsDir) {
    return;
  }

  await writeFile(
    resolve(report.artifactsDir, "verification-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  await writeFile(resolve(report.artifactsDir, "tester-report.md"), renderTesterReport(report));
}

function baseReport(input: {
  request: VerificationRunRequest;
  startedAt: string;
  finishedAt: string;
  artifactsDir: string;
  suites: VerificationSuite[];
}): VerificationRunReport {
  return {
    repairAttemptId: input.request.repairAttemptId,
    status: "blocked",
    prGate: "block",
    backendReason: "",
    backendFallback: false,
    suitesRequested: input.suites,
    suitesRun: [],
    suitesSkipped: [],
    commands: [],
    artifactsDir: input.artifactsDir,
    patchApplied: false,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  };
}

export async function runVerification(
  request: VerificationRunRequest
): Promise<VerificationRunReport> {
  const startedAt = new Date().toISOString();
  const sourceRoot = resolve(request.repository.checkoutPath);
  const loadedConfig = await loadProjectVerificationConfig(sourceRoot);
  const config = {
    ...loadedConfig,
    ...request.config,
    execution: {
      ...loadedConfig.execution,
      ...request.config?.execution,
    },
    commands: {
      ...loadedConfig.commands,
      ...request.config?.commands,
    },
    limits: {
      ...loadedConfig.limits,
      ...request.config?.limits,
    },
    docker: {
      ...loadedConfig.docker,
      ...request.config?.docker,
    },
    local: {
      ...loadedConfig.local,
      ...request.config?.local,
    },
  };
  const artifactsDir = await createArtifactsDir(request.artifactsDir);
  const suites = requestedSuites(request, config);
  const dockerAvailable = request.dockerAvailable ?? (await checkDockerAvailable());
  const selection = selectExecutionBackend({
    requestedBackend: request.backend,
    config,
    environment: request.environment,
    trustLevel: request.trustLevel,
    dockerAvailable,
    requiredSuites: suites,
  });

  if (selection.status === "blocked") {
    const report = {
      ...baseReport({
        request,
        startedAt,
        finishedAt: new Date().toISOString(),
        artifactsDir,
        suites,
      }),
      backendReason: selection.reason,
      backendFallback: selection.fallback,
      failureReason: selection.reason,
    };

    await writeReports(report);
    return report;
  }

  const profile = await selectTechnologyProfile(sourceRoot, config.profiles);
  const changedFiles = request.changedFiles?.length
    ? request.changedFiles
    : changedFilesFromPatch(request.patch);
  const profileCommands = await profile.buildCommands({
    rootPath: sourceRoot,
    changedFiles,
    selectedSuites: suites,
    config,
  });
  const commands = sortCommands(
    [...replicatorCommands(request), ...profileCommands]
      .filter((command) => commandIsSelected(command, suites))
      .map((command) => timeoutForCommand(command, config))
  );
  const commandResults: CommandResult[] = [];
  const workspace = await prepareWorkspace({
    backend: selection.backend,
    request,
    profile,
    config,
    artifactsDir,
  });
  let patchApplied = false;

  try {
    const patchResult = await applyWorkerPatch(workspace, request);
    patchApplied = patchResult.applied;

    if (patchResult.error) {
      const report = {
        ...baseReport({
          request,
          startedAt,
          finishedAt: new Date().toISOString(),
          artifactsDir,
          suites,
        }),
        selectedBackend: selection.backend,
        backendReason: selection.reason,
        backendFallback: selection.fallback,
        profileId: profile.id,
        workspacePath: workspace.workspacePath,
        patchApplied,
        failureReason: patchResult.error,
      };

      await writeReports(report);
      return report;
    }

    for (const command of commands) {
      if (!isAllowedCommand(command, config)) {
        commandResults.push(
          createSkippedResult(command, "Command is not allowed by project policy.")
        );
        continue;
      }

      const result = await runBackendCommand(selection.backend, workspace, command);
      commandResults.push(result);

      if (
        result.phase === "setup" &&
        (result.exitCode !== 0 || result.timedOut) &&
        !command.allowFailure
      ) {
        break;
      }
    }
  } finally {
    await cleanupWorkspace(workspace);
  }

  const status = statusFromResults(commandResults);
  const finishedAt = new Date().toISOString();
  const report: VerificationRunReport = {
    repairAttemptId: request.repairAttemptId,
    status: status.status,
    prGate: status.status === "passed" ? "allow" : "block",
    selectedBackend: selection.backend,
    backendReason: selection.reason,
    backendFallback: selection.fallback,
    profileId: profile.id,
    suitesRequested: suites,
    suitesRun: suitesRun(commandResults),
    suitesSkipped: suitesSkipped(suites, commands, commandResults),
    commands: commandResults,
    artifactsDir,
    workspacePath: workspace.workspacePath,
    patchApplied,
    failureReason: status.failureReason,
    startedAt,
    finishedAt,
  };

  await writeReports(report);
  return report;
}

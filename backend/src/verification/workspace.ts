import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { runShellCommand } from "./commands";
import type {
  ExecutionBackendId,
  PreparedWorkspace,
  ProjectVerificationConfig,
  TechnologyProfile,
  VerificationRunRequest,
} from "./types";

const EXCLUDED_WORKSPACE_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "out",
]);

function shouldCopyPath(sourcePath: string): boolean {
  return !EXCLUDED_WORKSPACE_NAMES.has(basename(sourcePath));
}

export async function createArtifactsDir(artifactsDir?: string): Promise<string> {
  const directory = artifactsDir
    ? resolve(artifactsDir)
    : await mkdtemp(join(tmpdir(), "aurakeeper-artifacts-"));

  await mkdir(directory, { recursive: true });

  return directory;
}

export async function prepareWorkspace(input: {
  backend: ExecutionBackendId;
  request: VerificationRunRequest;
  profile: TechnologyProfile;
  config: ProjectVerificationConfig;
  artifactsDir: string;
}): Promise<PreparedWorkspace> {
  const sourcePath = resolve(input.request.repository.checkoutPath);
  const workspaceParent = await mkdtemp(join(tmpdir(), "aurakeeper-workspace-"));
  const workspacePath = join(workspaceParent, basename(sourcePath) || "project");
  const keepWorkspace =
    input.request.keepWorkspace ??
    input.config.local?.keepWorkspace ??
    false;

  await cp(sourcePath, workspacePath, {
    recursive: true,
    filter: shouldCopyPath,
  });

  return {
    backend: input.backend,
    sourcePath,
    workspacePath,
    artifactsDir: input.artifactsDir,
    keepWorkspace,
    profile: input.profile,
    config: input.config,
  };
}

export async function applyWorkerPatch(
  workspace: PreparedWorkspace,
  request: VerificationRunRequest
): Promise<{ applied: boolean; error?: string }> {
  const patch = request.patchFile
    ? await readFile(request.patchFile, "utf8")
    : request.patch;

  if (!patch || patch.trim().length === 0) {
    return { applied: false };
  }

  const patchPath = join(workspace.artifactsDir, "worker.patch");
  await writeFile(patchPath, patch);

  const result = await runShellCommand(
    {
      id: "workspace:apply-patch",
      command: `git apply --whitespace=nowarn ${JSON.stringify(patchPath)}`,
      phase: "setup",
      source: "config",
      network: "disabled",
    },
    {
      cwd: workspace.workspacePath,
      timeoutMs: workspace.config.limits?.commandTimeoutMs ?? 60_000,
    }
  );

  if (result.exitCode !== 0) {
    return {
      applied: false,
      error: result.stderr || result.stdout || "Worker patch did not apply cleanly.",
    };
  }

  return { applied: true };
}

export async function cleanupWorkspace(workspace: PreparedWorkspace): Promise<void> {
  if (workspace.keepWorkspace) {
    return;
  }

  await rm(workspace.workspacePath, {
    recursive: true,
    force: true,
  });

  await rm(dirname(workspace.workspacePath), {
    recursive: true,
    force: true,
  });
}

import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve } from "node:path";

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

const WORKSPACE_PATCH_FILE = "worker.workspace.patch";
const ORIGINAL_PATCH_FILE = "worker.original.patch";

function shouldCopyPath(sourcePath: string): boolean {
  return !EXCLUDED_WORKSPACE_NAMES.has(basename(sourcePath));
}

function normalizeRelativePath(filePath: string): string {
  return normalize(filePath).replaceAll("\\", "/").replace(/^\.\/+/, "");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function bestPatchPathForRoot(rootPath: string, candidatePath: string): Promise<string> {
  const normalizedPath = normalizeRelativePath(candidatePath);

  if (
    normalizedPath.length === 0 ||
    normalizedPath === "/dev/null" ||
    normalizedPath.startsWith("../")
  ) {
    return normalizedPath;
  }

  if (await pathExists(resolve(rootPath, normalizedPath))) {
    return normalizedPath;
  }

  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);

  for (let index = 1; index < segments.length; index += 1) {
    const suffix = segments.slice(index).join("/");

    if (await pathExists(resolve(rootPath, suffix))) {
      return suffix;
    }
  }

  if (await pathExists(resolve(rootPath, dirname(normalizedPath)))) {
    return normalizedPath;
  }

  for (let index = 1; index < segments.length; index += 1) {
    const suffix = segments.slice(index).join("/");

    if (await pathExists(resolve(rootPath, dirname(suffix)))) {
      return suffix;
    }
  }

  return normalizedPath;
}

async function rewritePatchForRoot(rootPath: string, patch: string): Promise<string> {
  const lines = patch.split(/\r?\n/);
  const rewritten = await Promise.all(
    lines.map(async (line) => {
      const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

      if (diffMatch) {
        const oldPath = await bestPatchPathForRoot(rootPath, diffMatch[1]);
        const newPath = await bestPatchPathForRoot(rootPath, diffMatch[2]);

        return `diff --git a/${oldPath} b/${newPath}`;
      }

      const fileMatch = line.match(/^(---|\+\+\+) (.+)$/);

      if (!fileMatch) {
        return line;
      }

      const filePath = fileMatch[2];

      if (filePath === "/dev/null") {
        return line;
      }

      const normalizedPath = filePath.startsWith("a/") || filePath.startsWith("b/")
        ? filePath.slice(2)
        : filePath;
      const rewrittenPath = await bestPatchPathForRoot(rootPath, normalizedPath);

      if (filePath.startsWith("a/")) {
        return `${fileMatch[1]} a/${rewrittenPath}`;
      }

      if (filePath.startsWith("b/")) {
        return `${fileMatch[1]} b/${rewrittenPath}`;
      }

      return `${fileMatch[1]} ${rewrittenPath}`;
    })
  );

  return `${rewritten.join("\n")}\n`;
}

export async function normalizeChangedFiles(
  rootPath: string,
  changedFiles: string[] | undefined
): Promise<string[]> {
  if (!changedFiles?.length) {
    return [];
  }

  const normalized = await Promise.all(
    changedFiles.map((filePath) => bestPatchPathForRoot(rootPath, filePath))
  );

  return normalized.filter(
    (filePath, index) =>
      filePath.length > 0 &&
      filePath !== "/dev/null" &&
      !filePath.startsWith("../") &&
      normalized.indexOf(filePath) === index
  );
}

export type MaterializedWorkerPatch = {
  workspacePatch: string;
  originalPatch: string;
  workspacePatchFile: string;
  originalPatchFile: string;
  changedFiles: string[];
};

function changedFilesFromPatch(patch: string): string[] {
  const files = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice("+++ b/".length))
    .filter((filePath) => filePath && filePath !== "/dev/null");

  return files.filter((filePath, index) => files.indexOf(filePath) === index);
}

export async function materializeWorkerPatch(input: {
  sourcePath: string;
  artifactsDir: string;
  patch?: string;
  patchFile?: string;
}): Promise<MaterializedWorkerPatch | undefined> {
  const patchSource = input.patchFile
    ? await readFile(input.patchFile, "utf8")
    : input.patch;

  if (!patchSource || patchSource.trim().length === 0) {
    return undefined;
  }

  const originalPatch = await rewritePatchForRoot(input.sourcePath, patchSource);
  const workspacePatch = originalPatch;
  const workspacePatchFile = join(input.artifactsDir, WORKSPACE_PATCH_FILE);
  const originalPatchFile = join(input.artifactsDir, ORIGINAL_PATCH_FILE);

  await writeFile(workspacePatchFile, workspacePatch);
  await writeFile(originalPatchFile, originalPatch);

  return {
    workspacePatch,
    originalPatch,
    workspacePatchFile,
    originalPatchFile,
    changedFiles: changedFilesFromPatch(workspacePatch),
  };
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

export async function applyPatchToCheckout(input: {
  checkoutPath: string;
  patchFile: string;
  timeoutMs: number;
}): Promise<{ applied: boolean; error?: string }> {
  const applyCommand = `git apply --whitespace=nowarn ${JSON.stringify(input.patchFile)}`;
  const result = await runShellCommand(
    {
      id: "workspace:apply-patch",
      command: applyCommand,
      phase: "setup",
      source: "config",
      network: "disabled",
    },
    {
      cwd: input.checkoutPath,
      timeoutMs: input.timeoutMs,
    }
  );

  if (result.exitCode !== 0) {
    const reverseCheck = await runShellCommand(
      {
        id: "workspace:apply-patch-reverse-check",
        command: `git apply --reverse --check ${JSON.stringify(input.patchFile)}`,
        phase: "setup",
        source: "config",
        network: "disabled",
      },
      {
        cwd: input.checkoutPath,
        timeoutMs: input.timeoutMs,
      }
    );

    if (reverseCheck.exitCode === 0) {
      return { applied: true };
    }

    return {
      applied: false,
      error: result.stderr || result.stdout || "Worker patch did not apply cleanly.",
    };
  }

  return { applied: true };
}

export async function applyWorkerPatch(
  workspace: PreparedWorkspace,
  request: VerificationRunRequest
): Promise<{
  applied: boolean;
  error?: string;
  patch?: MaterializedWorkerPatch;
}> {
  const patch = await materializeWorkerPatch({
    sourcePath: workspace.sourcePath,
    artifactsDir: workspace.artifactsDir,
    patch: request.patch,
    patchFile: request.patchFile,
  });

  if (!patch) {
    return { applied: false };
  }

  const result = await applyPatchToCheckout({
    checkoutPath: workspace.workspacePath,
    patchFile: patch.workspacePatchFile,
    timeoutMs: workspace.config.limits?.commandTimeoutMs ?? 60_000,
  });

  return {
    applied: result.applied,
    error: result.error,
    patch,
  };
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

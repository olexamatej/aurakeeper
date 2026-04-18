import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

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

export type RenderedCheckoutPatch = {
  patch?: string;
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

type CodexPatchOperation =
  | {
      type: "add";
      path: string;
      lines: string[];
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "update";
      path: string;
      moveTo?: string;
      lines: string[];
    };

function isCodexApplyPatch(patch: string): boolean {
  return patch.trimStart().startsWith("*** Begin Patch");
}

function parseCodexApplyPatch(patch: string): CodexPatchOperation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");

  if (lines[0] !== "*** Begin Patch") {
    throw new Error("Unsupported worker patch format.");
  }

  const operations: CodexPatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];

    if (line === "*** End Patch") {
      return operations;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length);
      index += 1;
      const addLines: string[] = [];

      while (index < lines.length && !lines[index].startsWith("*** ")) {
        const nextLine = lines[index];

        if (!nextLine.startsWith("+")) {
          throw new Error(`Invalid add-file patch line: ${nextLine}`);
        }

        addLines.push(nextLine.slice(1));
        index += 1;
      }

      operations.push({
        type: "add",
        path,
        lines: addLines,
      });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: line.slice("*** Delete File: ".length),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length);
      index += 1;
      let moveTo: string | undefined;

      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = lines[index].slice("*** Move to: ".length);
        index += 1;
      }

      const updateLines: string[] = [];

      while (index < lines.length && !lines[index].startsWith("*** End Patch")) {
        const nextLine = lines[index];

        if (nextLine.startsWith("*** Update File: ") || nextLine.startsWith("*** Add File: ") || nextLine.startsWith("*** Delete File: ")) {
          break;
        }

        updateLines.push(nextLine);
        index += 1;
      }

      operations.push({
        type: "update",
        path,
        moveTo,
        lines: updateLines,
      });
      continue;
    }

    if (line === "") {
      index += 1;
      continue;
    }

    throw new Error(`Unsupported worker patch header: ${line}`);
  }

  throw new Error("Worker patch did not terminate with *** End Patch.");
}

function splitFileContent(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function joinPatchedLines(lines: string[]): string {
  return lines.join("\n");
}

function findSequence(lines: string[], sequence: string[], start: number): number {
  if (sequence.length === 0) {
    return start;
  }

  for (let index = start; index <= lines.length - sequence.length; index += 1) {
    let matches = true;

    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (lines[index + offset] !== sequence[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return index;
    }
  }

  return -1;
}

function applyCodexUpdateOperation(original: string, patchLines: string[]): string {
  const originalLines = splitFileContent(original);
  const output: string[] = [];
  let cursor = 0;
  let index = 0;

  while (index < patchLines.length) {
    if (patchLines[index] === "*** End of File") {
      index += 1;
      continue;
    }

    if (!patchLines[index].startsWith("@@")) {
      throw new Error(`Unsupported worker patch body line: ${patchLines[index]}`);
    }

    index += 1;
    const hunkLines: string[] = [];

    while (index < patchLines.length && !patchLines[index].startsWith("@@")) {
      if (patchLines[index] === "*** End of File") {
        index += 1;
        break;
      }

      hunkLines.push(patchLines[index]);
      index += 1;
    }

    const oldLines = hunkLines
      .filter((line) => line.startsWith(" ") || line.startsWith("-"))
      .map((line) => line.slice(1));
    const newLines = hunkLines
      .filter((line) => line.startsWith(" ") || line.startsWith("+"))
      .map((line) => line.slice(1));

    const matchIndex = findSequence(originalLines, oldLines, cursor);

    if (matchIndex < 0) {
      throw new Error("Worker patch could not be matched against the source file.");
    }

    output.push(...originalLines.slice(cursor, matchIndex), ...newLines);
    cursor = matchIndex + oldLines.length;
  }

  output.push(...originalLines.slice(cursor));

  return joinPatchedLines(output);
}

async function runDiffCommand(
  oldLabel: string,
  oldPath: string,
  newLabel: string,
  newPath: string
): Promise<string> {
  const command = [
    "diff",
    "-u",
    `--label=${oldLabel}`,
    `--label=${newLabel}`,
    JSON.stringify(oldPath),
    JSON.stringify(newPath),
  ].join(" ");

  const result = await runShellCommand(
    {
      id: "workspace:render-patch",
      command,
      phase: "setup",
      source: "config",
      network: "disabled",
    },
    {
      cwd: process.cwd(),
      timeoutMs: 30_000,
    }
  );

  if (result.exitCode === 0) {
    return "";
  }

  if (result.exitCode !== 1) {
    throw new Error(result.stderr || result.stdout || "Failed to render worker patch.");
  }

  return result.stdout;
}

async function convertCodexApplyPatchToUnifiedDiff(
  sourcePath: string,
  patch: string
): Promise<string> {
  const operations = parseCodexApplyPatch(patch);
  const tempRoot = await mkdtemp(join(tmpdir(), "aurakeeper-codex-patch-"));
  const originalRoot = join(tempRoot, "original");
  const modifiedRoot = join(tempRoot, "modified");
  const renderedDiffs: string[] = [];

  try {
    await mkdir(originalRoot, { recursive: true });
    await mkdir(modifiedRoot, { recursive: true });

    for (const operation of operations) {
      if (operation.type === "delete") {
        const sourceFile = resolve(sourcePath, operation.path);
        const originalContent = await readFile(sourceFile, "utf8");
        const oldTempPath = join(originalRoot, operation.path);
        const newTempPath = join(modifiedRoot, operation.path);

        await mkdir(dirname(oldTempPath), { recursive: true });
        await mkdir(dirname(newTempPath), { recursive: true });
        await writeFile(oldTempPath, originalContent);
        await writeFile(newTempPath, "");

        const diffBody = await runDiffCommand(
          `a/${operation.path}`,
          oldTempPath,
          "/dev/null",
          newTempPath
        );

        if (diffBody.trim().length > 0) {
          renderedDiffs.push(`diff --git a/${operation.path} b/${operation.path}\n${diffBody}`);
        }

        continue;
      }

      if (operation.type === "add") {
        const oldTempPath = join(originalRoot, operation.path);
        const newTempPath = join(modifiedRoot, operation.path);
        const newContent = `${operation.lines.join("\n")}\n`;

        await mkdir(dirname(oldTempPath), { recursive: true });
        await mkdir(dirname(newTempPath), { recursive: true });
        await writeFile(oldTempPath, "");
        await writeFile(newTempPath, newContent);

        const diffBody = await runDiffCommand(
          "/dev/null",
          oldTempPath,
          `b/${operation.path}`,
          newTempPath
        );

        if (diffBody.trim().length > 0) {
          renderedDiffs.push(`diff --git a/${operation.path} b/${operation.path}\n${diffBody}`);
        }

        continue;
      }

      const sourceFile = resolve(sourcePath, operation.path);
      const originalContent = await readFile(sourceFile, "utf8");
      const patchedContent = applyCodexUpdateOperation(originalContent, operation.lines);
      const newPath = operation.moveTo ?? operation.path;
      const oldTempPath = join(originalRoot, operation.path);
      const newTempPath = join(modifiedRoot, newPath);

      await mkdir(dirname(oldTempPath), { recursive: true });
      await mkdir(dirname(newTempPath), { recursive: true });
      await writeFile(oldTempPath, originalContent);
      await writeFile(newTempPath, patchedContent);

      const diffBody = await runDiffCommand(
        `a/${operation.path}`,
        oldTempPath,
        `b/${newPath}`,
        newTempPath
      );

      if (diffBody.trim().length > 0) {
        renderedDiffs.push(`diff --git a/${operation.path} b/${newPath}\n${diffBody}`);
      }
    }

    return renderedDiffs.join("");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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

  const canonicalPatch = isCodexApplyPatch(patchSource)
    ? await convertCodexApplyPatchToUnifiedDiff(input.sourcePath, patchSource)
    : patchSource;

  if (canonicalPatch.trim().length === 0) {
    return undefined;
  }

  const originalPatch = await rewritePatchForRoot(input.sourcePath, canonicalPatch);
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

export async function renderPatchFromCheckoutChanges(input: {
  sourcePath: string;
  modifiedPath: string;
  changedFiles?: string[];
}): Promise<RenderedCheckoutPatch> {
  const normalizedChangedFiles = await normalizeChangedFiles(
    input.modifiedPath,
    input.changedFiles
  );

  if (normalizedChangedFiles.length === 0) {
    return {
      patch: undefined,
      changedFiles: [],
    };
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "aurakeeper-rendered-worker-patch-"));
  const originalRoot = join(tempRoot, "original");
  const modifiedRoot = join(tempRoot, "modified");
  const renderedDiffs: string[] = [];
  const actualChangedFiles: string[] = [];

  try {
    await mkdir(originalRoot, { recursive: true });
    await mkdir(modifiedRoot, { recursive: true });

    for (const filePath of normalizedChangedFiles) {
      const sourceFile = resolve(input.sourcePath, filePath);
      const modifiedFile = resolve(input.modifiedPath, filePath);
      const sourceExists = await pathExists(sourceFile);
      const modifiedExists = await pathExists(modifiedFile);

      if (!sourceExists && !modifiedExists) {
        continue;
      }

      const oldTempPath = join(originalRoot, filePath);
      const newTempPath = join(modifiedRoot, filePath);

      await mkdir(dirname(oldTempPath), { recursive: true });
      await mkdir(dirname(newTempPath), { recursive: true });

      if (sourceExists) {
        await writeFile(oldTempPath, await readFile(sourceFile, "utf8"));
      } else {
        await writeFile(oldTempPath, "");
      }

      if (modifiedExists) {
        await writeFile(newTempPath, await readFile(modifiedFile, "utf8"));
      } else {
        await writeFile(newTempPath, "");
      }

      const diffBody = await runDiffCommand(
        sourceExists ? `a/${filePath}` : "/dev/null",
        oldTempPath,
        modifiedExists ? `b/${filePath}` : "/dev/null",
        newTempPath
      );

      if (diffBody.trim().length === 0) {
        continue;
      }

      renderedDiffs.push(`diff --git a/${filePath} b/${filePath}\n${diffBody}`);
      actualChangedFiles.push(filePath);
    }

    return {
      patch: renderedDiffs.length > 0 ? renderedDiffs.join("") : undefined,
      changedFiles: actualChangedFiles,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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

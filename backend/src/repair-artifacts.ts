import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import { and, desc, eq, inArray } from "drizzle-orm";

import { config } from "./config";
import { db } from "./db";
import { errorLogs, repairArtifacts, repairAttempts } from "./schema";
import {
  orchestrateRepair,
  type RepairAgentClient,
  type RepairOrchestrationOptions,
  type RepairOrchestrationReport,
  type RepairOrchestrationRequest,
} from "./verification/orchestrator";

type PersistRepairArtifactsInput = {
  errorLogId: string;
  report: RepairOrchestrationReport;
  artifactStoreRoot?: string;
};

export type StoredRepairArtifact = {
  id: string;
  repairAttemptId: string;
  kind: string;
  fileName: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
  url: string;
};

export type StoredRepairAttempt = {
  id: string;
  errorLogId: string;
  status: string;
  prGate: "allow" | "block";
  stage: string;
  selectedBackend?: string;
  profileId?: string;
  failureReason?: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  artifacts: StoredRepairArtifact[];
};

function createArtifactId(): string {
  return `artifact_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function classifyArtifact(fileName: string): string {
  const normalized = fileName.toLowerCase();

  if (/\.(png|jpg|jpeg|webp|gif)$/.test(normalized)) {
    return "screenshot";
  }

  if (normalized.endsWith(".patch") || normalized.endsWith(".diff")) {
    return "patch";
  }

  if (normalized.includes("report")) {
    return "report";
  }

  if (normalized.includes("agent-task")) {
    return "agent_task";
  }

  if (normalized.includes("agent-result")) {
    return "agent_result";
  }

  return "artifact";
}

function contentTypeFor(fileName: string): string {
  const extension = extname(fileName).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
    case ".log":
    case ".patch":
    case ".diff":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function collectFiles(rootPath: string, currentPath = ""): Promise<string[]> {
  const absolutePath = currentPath ? join(rootPath, currentPath) : rootPath;
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextRelative = currentPath ? join(currentPath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootPath, nextRelative)));
      continue;
    }

    if (entry.isFile()) {
      files.push(nextRelative);
    }
  }

  return files;
}

function artifactUrl(errorLogId: string, artifactId: string): string {
  return `/v1/logs/errors/${errorLogId}/artifacts/${artifactId}`;
}

export async function persistRepairArtifactsForErrorLog(
  input: PersistRepairArtifactsInput
): Promise<StoredRepairAttempt> {
  const errorLog = db
    .select()
    .from(errorLogs)
    .where(eq(errorLogs.id, input.errorLogId))
    .get();

  if (!errorLog) {
    throw new Error(`Error log '${input.errorLogId}' was not found.`);
  }

  const artifactStoreRoot = resolve(input.artifactStoreRoot ?? config.artifactsPath);
  const persistentDir = resolve(
    artifactStoreRoot,
    errorLog.projectId,
    input.errorLogId,
    input.report.repairAttemptId
  );
  const createdAt = new Date().toISOString();

  await mkdir(persistentDir, { recursive: true });
  await cp(input.report.artifactsDir, persistentDir, { recursive: true, force: true });

  db.delete(repairArtifacts)
    .where(eq(repairArtifacts.repairAttemptId, input.report.repairAttemptId))
    .run();
  db.delete(repairAttempts)
    .where(eq(repairAttempts.id, input.report.repairAttemptId))
    .run();

  db.insert(repairAttempts)
    .values({
      id: input.report.repairAttemptId,
      errorLogId: input.errorLogId,
      projectId: errorLog.projectId,
      status: input.report.status,
      prGate: input.report.prGate,
      stage: input.report.stage,
      selectedBackend: input.report.selectedBackend,
      profileId: input.report.profileId,
      artifactsDir: persistentDir,
      failureReason: input.report.failureReason,
      startedAt: input.report.startedAt,
      finishedAt: input.report.finishedAt,
      createdAt,
    })
    .run();

  const relativeFiles = await collectFiles(persistentDir);
  const artifacts = [];

  for (const relativePath of relativeFiles) {
    const absolutePath = resolve(persistentDir, relativePath);
    const fileStats = await stat(absolutePath);
    const id = createArtifactId();
    const fileName = basename(relativePath);

    db.insert(repairArtifacts)
      .values({
        id,
        repairAttemptId: input.report.repairAttemptId,
        errorLogId: input.errorLogId,
        projectId: errorLog.projectId,
        kind: classifyArtifact(fileName),
        fileName,
        relativePath,
        absolutePath,
        contentType: contentTypeFor(fileName),
        byteSize: fileStats.size,
        createdAt,
      })
      .run();

    artifacts.push({
      id,
      repairAttemptId: input.report.repairAttemptId,
      kind: classifyArtifact(fileName),
      fileName,
      relativePath,
      contentType: contentTypeFor(fileName),
      byteSize: fileStats.size,
      createdAt,
      url: artifactUrl(input.errorLogId, id),
    });
  }

  return {
    id: input.report.repairAttemptId,
    errorLogId: input.errorLogId,
    status: input.report.status,
    prGate: input.report.prGate,
    stage: input.report.stage,
    selectedBackend: input.report.selectedBackend,
    profileId: input.report.profileId,
    failureReason: input.report.failureReason,
    startedAt: input.report.startedAt,
    finishedAt: input.report.finishedAt,
    createdAt,
    artifacts,
  };
}

export async function orchestrateRepairForErrorLog(
  input: {
    errorLogId: string;
    request: RepairOrchestrationRequest;
  },
  agentClient: RepairAgentClient,
  options: RepairOrchestrationOptions = {}
): Promise<{
  report: RepairOrchestrationReport;
  repairAttempt: StoredRepairAttempt;
}> {
  const report = await orchestrateRepair(input.request, agentClient, options);
  const repairAttempt = await persistRepairArtifactsForErrorLog({
    errorLogId: input.errorLogId,
    report,
  });

  return {
    report,
    repairAttempt,
  };
}

export function listRepairAttemptsForErrorLog(
  projectId: string,
  errorLogId: string
): StoredRepairAttempt[] {
  const attempts = db
    .select()
    .from(repairAttempts)
    .where(and(eq(repairAttempts.projectId, projectId), eq(repairAttempts.errorLogId, errorLogId)))
    .orderBy(desc(repairAttempts.createdAt))
    .all();

  if (attempts.length === 0) {
    return [];
  }

  const attemptIds = attempts.map((attempt) => attempt.id);
  const artifacts = db
    .select()
    .from(repairArtifacts)
    .where(
      and(
        eq(repairArtifacts.projectId, projectId),
        eq(repairArtifacts.errorLogId, errorLogId),
        inArray(repairArtifacts.repairAttemptId, attemptIds)
      )
    )
    .all();

  return attempts.map((attempt) => ({
    id: attempt.id,
    errorLogId: attempt.errorLogId,
    status: attempt.status,
    prGate: attempt.prGate as "allow" | "block",
    stage: attempt.stage,
    selectedBackend: attempt.selectedBackend ?? undefined,
    profileId: attempt.profileId ?? undefined,
    failureReason: attempt.failureReason ?? undefined,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    createdAt: attempt.createdAt,
    artifacts: artifacts
      .filter((artifact) => artifact.repairAttemptId === attempt.id)
      .map((artifact) => ({
        id: artifact.id,
        repairAttemptId: artifact.repairAttemptId,
        kind: artifact.kind,
        fileName: artifact.fileName,
        relativePath: artifact.relativePath,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        createdAt: artifact.createdAt,
        url: artifactUrl(errorLogId, artifact.id),
      })),
  }));
}

export function getRepairArtifactForErrorLog(
  projectId: string,
  errorLogId: string,
  artifactId: string
): (typeof repairArtifacts.$inferSelect) | undefined {
  return db
    .select()
    .from(repairArtifacts)
    .where(
      and(
        eq(repairArtifacts.id, artifactId),
        eq(repairArtifacts.projectId, projectId),
        eq(repairArtifacts.errorLogId, errorLogId)
      )
    )
    .get();
}

export async function readRepairArtifactContent(
  projectId: string,
  errorLogId: string,
  artifactId: string
): Promise<{ content: Uint8Array; contentType: string; fileName: string } | undefined> {
  const artifact = getRepairArtifactForErrorLog(projectId, errorLogId, artifactId);

  if (!artifact) {
    return undefined;
  }

  const content = await readFile(artifact.absolutePath);

  return {
    content,
    contentType: artifact.contentType,
    fileName: artifact.fileName,
  };
}

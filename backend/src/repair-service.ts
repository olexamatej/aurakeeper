import { eq } from "drizzle-orm";

import { db } from "./db";
import {
  parseStoredErrorLogPayload,
  updateErrorLogState,
} from "./error-logs";
import { orchestrateRepairForErrorLog } from "./repair-artifacts";
import { errorLogs, projects } from "./schema";
import {
  CodexCliAgentClient,
  type RepairAgentClient,
} from "./verification";
import { ApiError, type IssueState } from "./validation";

type ProjectRow = typeof projects.$inferSelect;
type ErrorLogRow = typeof errorLogs.$inferSelect;

export type StartRepairResult =
  | {
      status: "queued";
      state: IssueState;
      logId: string;
    }
  | {
      status: "already_running";
      state: IssueState;
      logId: string;
    };

export type RepairCoordinatorOptions = {
  agentClient?: RepairAgentClient;
};

export type ActiveRepairStatus = {
  running: boolean;
  logId: string;
  repairAttemptId: string;
  stage:
    | "backend_selection"
    | "context"
    | "replicator"
    | "worker"
    | "verification"
    | "tester"
    | "complete";
  state: IssueState;
  detail: string;
  startedAt: string;
  updatedAt: string;
  selectedBackend?: "docker" | "local";
  profileId?: string;
};

function finalStateFromReportStage(input: {
  stage: string;
  status: string;
}): IssueState {
  if (input.stage === "complete") {
    return input.status === "passed" ? "verify_succeeded" : "verify_failed";
  }

  if (
    input.stage === "backend_selection" ||
    input.stage === "context" ||
    input.stage === "replicator"
  ) {
    return "repro_failed";
  }

  if (input.stage === "worker") {
    return "fix_failed";
  }

  return "verify_failed";
}

function buildRepairRequest(
  project: ProjectRow,
  errorLog: ErrorLogRow,
  issueSummary?: string
) {
  if (!project.repairCheckoutPath) {
    throw new ApiError(
      409,
      "repair_not_configured",
      "Project is missing repair.checkoutPath and cannot run fix agents"
    );
  }

  const payload = parseStoredErrorLogPayload(errorLog);

  if (!payload) {
    throw new ApiError(500, "internal_error", "Stored error log payload is invalid");
  }

  return {
    repository: {
      checkoutPath: project.repairCheckoutPath,
      baseCommit: project.repairBaseCommit ?? undefined,
      url: project.repairRepositoryUrl ?? undefined,
    },
    error: payload,
    issueSummary,
    backend:
      (project.repairBackend as "docker" | "local" | "auto" | null) ?? undefined,
    environment:
      (project.repairEnvironment as
        | "production"
        | "hosted"
        | "local"
        | "development"
        | null) ?? undefined,
    trustLevel:
      (project.repairTrustLevel as "trusted" | "untrusted" | null) ?? undefined,
  };
}

function stateFromActiveStage(
  stage: ActiveRepairStatus["stage"]
): IssueState {
  switch (stage) {
    case "backend_selection":
    case "context":
    case "replicator":
      return "repro_started";
    case "worker":
      return "fix_started";
    case "verification":
    case "tester":
      return "verify_started";
    case "complete":
      return "verify_succeeded";
  }
}

export class RepairCoordinator {
  private readonly agentClient: RepairAgentClient;
  private readonly activeJobs = new Map<string, Promise<void>>();
  private readonly activeStatuses = new Map<string, ActiveRepairStatus>();

  constructor(options: RepairCoordinatorOptions = {}) {
    this.agentClient = options.agentClient ?? new CodexCliAgentClient();
  }

  startRepair(
    project: ProjectRow,
    errorLog: ErrorLogRow,
    options: {
      issueSummary?: string;
    } = {}
  ): StartRepairResult {
    const active = this.activeJobs.get(errorLog.id);

    if (active) {
      return {
        status: "already_running",
        state: errorLog.state as IssueState,
        logId: errorLog.id,
      };
    }

    const request = buildRepairRequest(project, errorLog, options.issueSummary);
    updateErrorLogState(errorLog.id, "repro_started");

    const startedAt = new Date().toISOString();
    this.activeStatuses.set(errorLog.id, {
      running: true,
      logId: errorLog.id,
      repairAttemptId: request.repairAttemptId ?? `pending_${errorLog.id}`,
      stage: "replicator",
      state: "repro_started",
      detail: "Repair queued and waiting to start the replicator.",
      startedAt,
      updatedAt: startedAt,
    });

    const job = orchestrateRepairForErrorLog(
      {
        errorLogId: errorLog.id,
        request,
      },
      this.agentClient,
      {
        onStageChange: async (update) => {
          const nextStatus: ActiveRepairStatus = {
            running: update.stage !== "complete",
            logId: errorLog.id,
            repairAttemptId: update.repairAttemptId,
            stage: update.stage,
            state: stateFromActiveStage(update.stage),
            detail: update.detail,
            startedAt:
              this.activeStatuses.get(errorLog.id)?.startedAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            selectedBackend: update.selectedBackend,
            profileId: update.profileId,
          };

          this.activeStatuses.set(errorLog.id, nextStatus);

          if (update.stage !== "complete") {
            updateErrorLogState(errorLog.id, nextStatus.state);
          }
        },
      }
    )
      .then(({ report }) => {
        updateErrorLogState(
          errorLog.id,
          finalStateFromReportStage({
            stage: report.stage,
            status: report.status,
          })
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        updateErrorLogState(errorLog.id, "fix_failed");
      })
      .finally(() => {
        this.activeJobs.delete(errorLog.id);
        this.activeStatuses.delete(errorLog.id);
      });

    this.activeJobs.set(errorLog.id, job);

    return {
      status: "queued",
      state: "repro_started",
      logId: errorLog.id,
    };
  }

  getActiveStatus(logId: string): ActiveRepairStatus | undefined {
    return this.activeStatuses.get(logId);
  }
}

export const repairCoordinator = new RepairCoordinator();

export function shouldAutoTriggerRepair(project: ProjectRow): boolean {
  return Boolean(project.repairCheckoutPath && project.repairAutoTrigger);
}

export function requireProjectRepairTarget(project: ProjectRow): void {
  if (!project.repairCheckoutPath) {
    throw new ApiError(
      409,
      "repair_not_configured",
      "Project is missing repair.checkoutPath and cannot run fix agents"
    );
  }
}

export function findErrorLogById(errorLogId: string): ErrorLogRow | undefined {
  return db.select().from(errorLogs).where(eq(errorLogs.id, errorLogId)).get();
}

export function findProjectById(projectId: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

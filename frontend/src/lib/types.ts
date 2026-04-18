export type ErrorLogState =
  | "new_error"
  | "repro_started"
  | "repro_succeeded"
  | "repro_failed"
  | "fix_started"
  | "fix_succeeded"
  | "fix_failed"
  | "verify_started"
  | "verify_succeeded"
  | "verify_failed"
  | "deploy_started"
  | "deploy_succeeded"
  | "deploy_failed"

export type ErrorLevel = "debug" | "info" | "warning" | "error" | "critical"

export interface StoredProject {
  id: string
  name: string
  token: string
  repair?: ProjectRepairSettings
  createdAt: string
}

export interface ProjectRepairSettings {
  checkoutPath: string
  repositoryUrl?: string
  baseCommit?: string
  backend?: "auto" | "docker" | "local"
  environment?: "production" | "hosted" | "local" | "development"
  trustLevel?: "trusted" | "untrusted"
  promotionMode?: "auto" | "manual"
  autoTrigger?: boolean
}

export interface ServiceDescriptor {
  name: string
  version?: string
  instanceId?: string
}

export interface ErrorSource {
  runtime: string
  language: string
  framework?: string
  component?: string
}

export interface ErrorPayload {
  type?: string
  message: string
  code?: string
  stack?: string
  handled?: boolean
  details?: Record<string, unknown>
}

export interface ErrorContext {
  request?: Record<string, unknown>
  user?: Record<string, unknown>
  session?: Record<string, unknown>
  device?: Record<string, unknown>
  correlationId?: string
  tags?: string[]
  [key: string]: unknown
}

export interface ErrorLog {
  id: string
  state: ErrorLogState
  receivedAt: string
  createdAt: string
  eventId?: string
  occurredAt: string
  level: ErrorLevel
  platform: string
  environment?: string
  service: ServiceDescriptor
  source: ErrorSource
  error: ErrorPayload
  context?: ErrorContext
}

export interface ExampleDefinition {
  id: string
  name: string
  description: string
  manual?: string
}

export type ExampleRunStatus = "running" | "completed" | "failed"

export interface ExampleRun {
  id: string
  exampleId: string
  status: ExampleRunStatus
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  signal?: string | null
  triggerStatus?: number
  stdout: string
  stderr: string
  error?: string
  manual?: string
}

export interface RepairArtifact {
  id: string
  repairAttemptId: string
  kind: string
  fileName: string
  relativePath: string
  contentType: string
  byteSize: number
  createdAt: string
  url: string
}

export interface RepairAttempt {
  id: string
  errorLogId: string
  status: string
  prGate: "allow" | "block"
  stage: string
  selectedBackend?: string
  profileId?: string
  targetCheckoutPath?: string
  promotionMode: "auto" | "manual"
  sourcePatchStatus: "not_requested" | "pending_manual" | "applied" | "failed"
  sourcePatchAppliedAt?: string
  sourcePatchError?: string
  failureReason?: string
  startedAt: string
  finishedAt: string
  createdAt: string
  artifacts: RepairArtifact[]
}

export interface RepairAttemptAccepted {
  status: "queued" | "already_running"
  state: ErrorLogState
  logId: string
}

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
  createdAt: string
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

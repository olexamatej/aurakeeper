import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  applyRepairAttemptPatch,
  fetchArtifact,
  listRepairAttempts,
  startRepairAttempt,
} from "@/lib/api"
import type { ErrorLog, StoredProject } from "@/lib/types"

interface ErrorLogDetailProps {
  log: ErrorLog
  project: StoredProject
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value?: string | boolean | null }) {
  if (value === undefined || value === null) return null
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : value
  return (
    <div className="flex gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="break-all">{display}</span>
    </div>
  )
}

function JsonBlock({ data }: { data: unknown }) {
  if (!data) return null
  return (
    <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function sourcePatchStatusLabel(
  status: "not_requested" | "pending_manual" | "applied" | "failed",
): string {
  switch (status) {
    case "pending_manual":
      return "Awaiting manual apply"
    case "applied":
      return "Applied to original checkout"
    case "failed":
      return "Apply to original checkout failed"
    default:
      return "Not applied to original checkout"
  }
}

export function ErrorLogDetail({ log, project }: ErrorLogDetailProps) {
  const queryClient = useQueryClient()
  const [issueSummary, setIssueSummary] = useState("")
  const canRepair = Boolean(project.repair?.checkoutPath)
  const { data: attempts, isLoading: attemptsLoading } = useQuery({
    queryKey: ["repairAttempts", project.id, log.id],
    queryFn: () => listRepairAttempts(project.token, log.id),
    refetchInterval: log.state.endsWith("_started") ? 5_000 : 15_000,
  })
  const latestAttempt = useMemo(() => attempts?.[0], [attempts])
  const repairMutation = useMutation({
    mutationFn: () => startRepairAttempt(project.token, log.id, issueSummary.trim() || undefined),
    onSuccess: (result) => {
      toast.success(result.status === "queued" ? "Fix queued" : "Fix already running", {
        description:
          result.status === "queued"
            ? "AuraKeeper started the repair agents for this error."
            : "There is already an active repair attempt for this error.",
      })
      setIssueSummary("")
      void queryClient.invalidateQueries({ queryKey: ["errorLogs", project.id] })
      void queryClient.invalidateQueries({ queryKey: ["repairAttempts", project.id, log.id] })
    },
    onError: (error: Error) => {
      toast.error("Failed to start repair", {
        description: error.message,
      })
    },
  })
  const applyPatchMutation = useMutation({
    mutationFn: (repairAttemptId: string) =>
      applyRepairAttemptPatch(project.token, log.id, repairAttemptId),
    onSuccess: (attempt) => {
      toast.success("Verified patch applied", {
        description:
          attempt.sourcePatchStatus === "applied"
            ? "AuraKeeper applied the verified patch back to the original checkout."
            : "AuraKeeper updated the repair attempt status.",
      })
      void queryClient.invalidateQueries({ queryKey: ["errorLogs", project.id] })
      void queryClient.invalidateQueries({ queryKey: ["repairAttempts", project.id, log.id] })
    },
    onError: (error: Error) => {
      toast.error("Failed to apply verified patch", {
        description: error.message,
      })
    },
  })
  const artifactMutation = useMutation({
    mutationFn: async (input: { artifactId: string; fileName: string }) => {
      const blob = await fetchArtifact(project.token, log.id, input.artifactId)
      return {
        blob,
        fileName: input.fileName,
      }
    },
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob)
      const opened = window.open(url, "_blank", "noopener,noreferrer")

      if (!opened) {
        toast.info("Popup blocked", {
          description: `Allow popups to open ${fileName}.`,
        })
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    onError: (error: Error) => {
      toast.error("Failed to open artifact", {
        description: error.message,
      })
    },
  })

  return (
    <div className="space-y-4 px-4 pb-4 pt-2 overflow-hidden">
      <Section title="Repair">
        {canRepair ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {project.repair?.autoTrigger ? "Auto-run is enabled" : "Manual fixes only"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Target repo: {project.repair?.checkoutPath}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Verified patch apply: {project.repair?.promotionMode === "manual" ? "Manual" : "Auto"}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => repairMutation.mutate()}
                  disabled={repairMutation.isPending}
                >
                  {repairMutation.isPending ? "Starting..." : "Fix This Error"}
                </Button>
              </div>
              <textarea
                value={issueSummary}
                onChange={(e) => setIssueSummary(e.target.value)}
                placeholder="Optional guidance for the repair agents"
                className="mt-3 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">Repair attempts</p>
              {attemptsLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading repair attempts...</p>
              ) : attempts && attempts.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {attempts.map((attempt) => (
                    <div key={attempt.id} className="rounded-md bg-muted/50 p-3 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={attempt.prGate === "allow" ? "secondary" : "destructive"}>
                          {attempt.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {attempt.stage} • {formatTime(attempt.createdAt)}
                        </span>
                      </div>
                      {attempt.failureReason ? (
                        <p className="mt-2 text-sm text-muted-foreground break-all whitespace-pre-wrap">{attempt.failureReason}</p>
                      ) : null}
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>
                          Verified patch apply mode: {attempt.promotionMode === "manual" ? "Manual" : "Auto"}
                        </p>
                        <p>{sourcePatchStatusLabel(attempt.sourcePatchStatus)}</p>
                        {attempt.sourcePatchAppliedAt ? (
                          <p>Applied at: {formatTime(attempt.sourcePatchAppliedAt)}</p>
                        ) : null}
                        {attempt.sourcePatchError ? (
                          <p className="break-all whitespace-pre-wrap">
                            Apply error: {attempt.sourcePatchError}
                          </p>
                        ) : null}
                        {attempt.targetCheckoutPath ? (
                          <p className="break-all">Original checkout: {attempt.targetCheckoutPath}</p>
                        ) : null}
                      </div>
                      {attempt.prGate === "allow" &&
                      attempt.status === "passed" &&
                      attempt.sourcePatchStatus !== "applied" ? (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyPatchMutation.mutate(attempt.id)}
                            disabled={applyPatchMutation.isPending}
                          >
                            {applyPatchMutation.isPending
                              ? "Applying..."
                              : attempt.sourcePatchStatus === "failed"
                                ? "Retry Apply to Original Checkout"
                                : "Apply Verified Patch"}
                          </Button>
                        </div>
                      ) : null}
                      {attempt.artifacts.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {attempt.artifacts.map((artifact) => (
                            <button
                              key={artifact.id}
                              type="button"
                              onClick={() =>
                                artifactMutation.mutate({
                                  artifactId: artifact.id,
                                  fileName: artifact.fileName,
                                })
                              }
                              className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                            >
                              {artifact.kind}: {artifact.fileName}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No repair attempts yet. Start one manually or enable auto-run when creating the project.
                </p>
              )}
              {latestAttempt ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Latest attempt: {latestAttempt.status} at {formatTime(latestAttempt.finishedAt)}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            This project does not have a repair checkout path configured, so the fix agents cannot run yet.
            Create a new project with a repair path to enable manual fixes and auto-run.
          </div>
        )}
      </Section>

      <Separator />

      <Section title="Error">
        <div className="space-y-1">
          <KeyValue label="Type" value={log.error.type} />
          <KeyValue label="Message" value={log.error.message} />
          <KeyValue label="Code" value={log.error.code} />
          <KeyValue label="Handled" value={log.error.handled} />
        </div>
        {log.error.stack && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {log.error.stack}
          </pre>
        )}
        {log.error.details && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">Details</p>
            <JsonBlock data={log.error.details} />
          </>
        )}
      </Section>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Service">
          <div className="space-y-1">
            <KeyValue label="Name" value={log.service.name} />
            <KeyValue label="Version" value={log.service.version} />
            <KeyValue label="Instance" value={log.service.instanceId} />
          </div>
        </Section>

        <Section title="Source">
          <div className="space-y-1">
            <KeyValue label="Runtime" value={log.source.runtime} />
            <KeyValue label="Language" value={log.source.language} />
            <KeyValue label="Framework" value={log.source.framework} />
            <KeyValue label="Component" value={log.source.component} />
          </div>
        </Section>
      </div>

      {log.context && (
        <>
          <Separator />
          <Section title="Context">
            {log.context.tags && log.context.tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {log.context.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <JsonBlock data={log.context} />
          </Section>
        </>
      )}

      <Separator />

      <Section title="Metadata">
        <div className="grid gap-1 sm:grid-cols-2">
          <KeyValue label="Log ID" value={log.id} />
          <KeyValue label="Event ID" value={log.eventId} />
          <KeyValue label="Occurred at" value={log.occurredAt} />
          <KeyValue label="Received at" value={log.receivedAt} />
        </div>
      </Section>
    </div>
  )
}

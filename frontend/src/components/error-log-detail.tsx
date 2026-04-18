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
      <h4 className="mb-2 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
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
    <div className="flex gap-2 text-sm leading-relaxed">
      <span className="shrink-0 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{label}:</span>
      <span className="break-all">{display}</span>
    </div>
  )
}

function JsonBlock({ data }: { data: unknown }) {
  if (!data) return null
  return (
    <pre className="mt-1 max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
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
    <div className="space-y-5 overflow-hidden px-4 pb-4 pt-3">
      <Section title="Repair">
        {canRepair ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-heading text-base font-medium">
                    {project.repair?.autoTrigger ? "Auto-run is enabled" : "Manual fixes only"}
                  </p>
                  <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    Target repo: {project.repair?.checkoutPath}
                  </p>
                  <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    Agent: {project.repair?.agent ?? "codex"}
                  </p>
                  <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
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
                className="mt-3 min-h-24 w-full rounded-lg border border-white/10 bg-black/50 px-4 py-3 text-sm text-foreground placeholder:text-white/35 outline-none transition-all duration-200 focus:border-[#A855F7]/85 focus:shadow-[0_10px_20px_-10px_rgba(168,85,247,0.55)]"
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="font-heading text-base font-medium">Repair attempts</p>
              {attemptsLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading repair attempts...</p>
              ) : attempts && attempts.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {attempts.map((attempt) => (
                    <div key={attempt.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={attempt.prGate === "allow" ? "secondary" : "destructive"}>
                          {attempt.status}
                        </Badge>
                        <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                          {attempt.stage} • {formatTime(attempt.createdAt)}
                        </span>
                      </div>
                      {attempt.failureReason ? (
                        <p className="mt-2 text-sm text-muted-foreground break-all whitespace-pre-wrap">{attempt.failureReason}</p>
                      ) : null}
                      <div className="mt-2 space-y-1 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
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
                              className="rounded-full border border-white/20 bg-transparent px-3 py-1 font-mono text-[11px] tracking-wide text-foreground uppercase transition-all duration-200 hover:border-[#A855F7]/80 hover:bg-[#A855F7]/20"
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
                <p className="mt-3 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                  Latest attempt: {latestAttempt.status} at {formatTime(latestAttempt.finishedAt)}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-muted-foreground">
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
          <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {log.error.stack}
          </pre>
        )}
        {log.error.details && (
          <>
            <p className="mt-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Details</p>
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

import { useCallback, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorLogDetail } from "@/components/error-log-detail"
import { ExampleRunner } from "@/components/example-runner"
import { listErrorLogs } from "@/lib/api"
import type { ErrorLog, ErrorLogState, ErrorLevel, StoredProject } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ErrorLogsTableProps {
  project: StoredProject
}

const LEVEL_VARIANT: Record<ErrorLevel, "default" | "secondary" | "destructive" | "outline"> = {
  debug: "outline",
  info: "secondary",
  warning: "default",
  error: "destructive",
  critical: "destructive",
}

const STATE_LABELS: Partial<Record<ErrorLogState, { label: string; className: string }>> = {
  new_error: { label: "New", className: "border-red-500/60 bg-red-500/20 text-red-200" },
  repro_started: { label: "Repro", className: "border-[#7C3AED]/80 bg-[#7C3AED]/32 text-[#EEE5FF]" },
  repro_succeeded: {
    label: "Reproduced",
    className: "border-[#A855F7]/80 bg-[#A855F7]/30 text-[#F5E9FF]",
  },
  repro_failed: { label: "Repro failed", className: "border-white/20 bg-white/5 text-muted-foreground" },
  fix_started: { label: "Fixing", className: "border-[#7C3AED]/80 bg-[#7C3AED]/32 text-[#EEE5FF]" },
  fix_succeeded: { label: "Fixed", className: "border-[#C084FC]/80 bg-[#C084FC]/30 text-[#F5E9FF]" },
  fix_failed: { label: "Fix failed", className: "border-red-500/60 bg-red-500/20 text-red-200" },
  verify_started: { label: "Verifying", className: "border-[#7C3AED]/80 bg-[#7C3AED]/32 text-[#EEE5FF]" },
  verify_succeeded: { label: "Verified", className: "border-[#C084FC]/80 bg-[#C084FC]/30 text-[#F5E9FF]" },
  verify_failed: { label: "Verify failed", className: "border-red-500/60 bg-red-500/20 text-red-200" },
  deploy_started: { label: "Deploying", className: "border-[#7C3AED]/80 bg-[#7C3AED]/32 text-[#EEE5FF]" },
  deploy_succeeded: { label: "Deployed", className: "border-[#C084FC]/80 bg-[#C084FC]/30 text-[#F5E9FF]" },
  deploy_failed: { label: "Deploy failed", className: "border-red-500/60 bg-red-500/20 text-red-200" },
}

function StateBadge({ state }: { state: ErrorLogState }) {
  const config = STATE_LABELS[state] ?? { label: state, className: "" }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium tracking-wider uppercase",
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return iso
  }
}

function LogRow({ log, project }: { log: ErrorLog; project: StoredProject }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <TableRow
        className="group cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="w-8 px-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[#C084FC]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-[#C084FC]" />
          )}
        </TableCell>
        <TableCell>
          <StateBadge state={log.state} />
        </TableCell>
        <TableCell>
          <Badge variant={LEVEL_VARIANT[log.level]}>{log.level}</Badge>
        </TableCell>
        <TableCell className="truncate font-mono text-sm">
          {log.error.type && (
            <span className="font-semibold text-[#E9D5FF]">{log.error.type}: </span>
          )}
          {log.error.message}
        </TableCell>
        <TableCell className="truncate text-muted-foreground">
          {log.source.framework ?? log.source.runtime}
        </TableCell>
        <TableCell className="truncate text-muted-foreground">
          {log.environment ?? "-"}
        </TableCell>
        <TableCell className="truncate text-muted-foreground">
          {formatTime(log.occurredAt)}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-black/35 p-0">
            <ErrorLogDetail log={log} project={project} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export function ErrorLogsTable({ project }: ErrorLogsTableProps) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["errorLogs", project.id],
    queryFn: () => listErrorLogs(project.token),
    refetchInterval: 10_000,
  })
  const handleRunSettled = useCallback(() => {
    void refetch()
  }, [refetch])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0F1115]/70 px-6 py-4 backdrop-blur-md">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">{project.name}</h2>
          <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            {data ? `${data.length} error log${data.length !== 1 ? "s" : ""}` : "Loading..."}
          </p>
          {project.repair?.checkoutPath ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {project.repair.autoTrigger ? "Auto-fix enabled" : "Manual fix mode"} at {project.repair.checkoutPath}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No repair target configured for this project yet.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[128px]"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      <ExampleRunner project={project} onRunSettled={handleRunSettled} />

      {isLoading ? (
        <div className="space-y-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-panel mx-6 rounded-2xl px-8 py-10 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="mt-3 font-heading text-xl font-medium">Failed to load error logs</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error?.message ?? "Unknown error"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : data && data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-panel mx-6 rounded-2xl px-8 py-10 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-[#A855F7]/95" />
            <p className="mt-3 font-heading text-xl font-medium text-muted-foreground">
              No error logs yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Errors will appear here once your connector starts sending them
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-24">State</TableHead>
                <TableHead className="w-20">Level</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-24">Source</TableHead>
                <TableHead className="w-20">Env</TableHead>
                <TableHead className="w-36">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((log) => <LogRow key={log.id} log={log} project={project} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

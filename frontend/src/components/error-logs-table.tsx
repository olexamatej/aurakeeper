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
import { ScrollArea } from "@/components/ui/scroll-area"
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
  new_error: { label: "New", className: "bg-red-100 text-red-800" },
  repro_started: { label: "Repro", className: "bg-yellow-100 text-yellow-800" },
  repro_succeeded: { label: "Reproduced", className: "bg-yellow-100 text-yellow-800" },
  repro_failed: { label: "Repro failed", className: "bg-gray-100 text-gray-800" },
  fix_started: { label: "Fixing", className: "bg-blue-100 text-blue-800" },
  fix_succeeded: { label: "Fixed", className: "bg-green-100 text-green-800" },
  fix_failed: { label: "Fix failed", className: "bg-red-100 text-red-800" },
  verify_started: { label: "Verifying", className: "bg-blue-100 text-blue-800" },
  verify_succeeded: { label: "Verified", className: "bg-green-100 text-green-800" },
  verify_failed: { label: "Verify failed", className: "bg-red-100 text-red-800" },
  deploy_started: { label: "Deploying", className: "bg-blue-100 text-blue-800" },
  deploy_succeeded: { label: "Deployed", className: "bg-green-100 text-green-800" },
  deploy_failed: { label: "Deploy failed", className: "bg-red-100 text-red-800" },
}

function StateBadge({ state }: { state: ErrorLogState }) {
  const config = STATE_LABELS[state] ?? { label: state, className: "" }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
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

function LogRow({ log }: { log: ErrorLog }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="w-8 px-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <StateBadge state={log.state} />
        </TableCell>
        <TableCell>
          <Badge variant={LEVEL_VARIANT[log.level]}>{log.level}</Badge>
        </TableCell>
        <TableCell className="max-w-xs truncate font-mono text-sm">
          {log.error.type && (
            <span className="font-semibold">{log.error.type}: </span>
          )}
          {log.error.message}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {log.source.framework ?? log.source.runtime}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {log.environment ?? "-"}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {formatTime(log.occurredAt)}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-0">
            <ErrorLogDetail log={log} />
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
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h2 className="text-lg font-semibold">{project.name}</h2>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.length} error log${data.length !== 1 ? "s" : ""}` : "Loading..."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
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
          <div className="text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="mt-3 font-medium">Failed to load error logs</p>
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
          <div className="text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-medium text-muted-foreground">
              No error logs yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Errors will appear here once your connector starts sending them
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-28">State</TableHead>
                <TableHead className="w-24">Level</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-28">Source</TableHead>
                <TableHead className="w-28">Env</TableHead>
                <TableHead className="w-40">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((log) => <LogRow key={log.id} log={log} />)}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  )
}

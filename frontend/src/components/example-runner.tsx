import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertCircle, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getExampleRun, listExamples, startExampleRun } from "@/lib/api"
import type { ExampleRun, StoredProject } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ExampleRunnerProps {
  project: StoredProject
  onRunSettled: () => void
}

function outputPreview(run: ExampleRun): string {
  const combined = [run.stdout, run.stderr, run.error].filter(Boolean).join("\n")
  return combined.trim()
}

export function ExampleRunner({ project, onRunSettled }: ExampleRunnerProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<ExampleRun | null>(null)

  const examples = useQuery({
    queryKey: ["examples"],
    queryFn: listExamples,
  })

  const runQuery = useQuery({
    queryKey: ["exampleRun", selectedRunId],
    queryFn: () => getExampleRun(selectedRunId as string),
    enabled: selectedRunId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 1000 : false,
  })

  const startRun = useMutation({
    mutationFn: (exampleId: string) => startExampleRun(exampleId, project.token),
    onSuccess: (run) => {
      setSelectedRunId(run.id)
      setSelectedRun(run)
    },
  })

  useEffect(() => {
    if (!runQuery.data) return

    setSelectedRun(runQuery.data)

    if (runQuery.data.status !== "running") {
      onRunSettled()
    }
  }, [onRunSettled, runQuery.data])

  return (
    <div className="border-b px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Connector examples</h3>
          <p className="text-xs text-muted-foreground">
            Run a local stack demo that sends a runtime error to this project.
          </p>
        </div>
        {examples.isFetching && (
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {examples.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          Failed to load examples
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {examples.data?.map((example) => (
            <Button
              key={example.id}
              variant="outline"
              className="h-auto justify-start px-3 py-2 text-left"
              disabled={startRun.isPending}
              onClick={() => startRun.mutate(example.id)}
            >
              <Play className="mr-2 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{example.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {example.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}

      {(startRun.isError || selectedRun) && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
          {startRun.isError ? (
            <p className="text-sm text-destructive">
              {(startRun.error as Error).message}
            </p>
          ) : selectedRun ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Badge
                  variant={
                    selectedRun.status === "failed" ? "destructive" : "secondary"
                  }
                  className={cn(selectedRun.status === "running" && "animate-pulse")}
                >
                  {selectedRun.status}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedRun.exampleId} / {selectedRun.id}
                </span>
              </div>
              {selectedRun.manual && (
                <p className="text-sm text-muted-foreground">{selectedRun.manual}</p>
              )}
              {outputPreview(selectedRun) && (
                <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 text-xs">
                  {outputPreview(selectedRun)}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

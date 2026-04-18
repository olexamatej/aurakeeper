import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertCircle, ChevronRight, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-white/10 bg-[#0F1115]/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-white/[0.03]">
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <div className="flex-1">
          <h3 className="font-heading text-base font-semibold">Connector examples</h3>
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            Run a local stack demo that sends a runtime error to this project.
          </p>
        </div>
        {examples.isFetching && (
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden px-6 pb-5">
        {examples.isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Failed to load examples
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {examples.data?.map((example) => (
              <Button
                key={example.id}
                variant="outline"
                className="h-auto justify-start px-4 py-3 text-left"
                disabled={startRun.isPending}
                onClick={() => startRun.mutate(example.id)}
              >
                <Play className="mr-2 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{example.name}</span>
                  <span className="block truncate font-mono text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
                    {example.description}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        )}

        {(startRun.isError || selectedRun) && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
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
                    className={cn(selectedRun.status === "running" && "animate-pulse-live")}
                  >
                    {selectedRun.status}
                  </Badge>
                  <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    {selectedRun.exampleId} / {selectedRun.id}
                  </span>
                </div>
                {selectedRun.manual && (
                  <p className="text-sm text-muted-foreground">{selectedRun.manual}</p>
                )}
                {outputPreview(selectedRun) && (
                  <pre className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/45 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                    {outputPreview(selectedRun)}
                  </pre>
                )}
              </div>
            ) : null}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

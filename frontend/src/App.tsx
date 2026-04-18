import { useState, useCallback } from "react"
import { ProjectList } from "@/components/project-list"
import { ErrorLogsTable } from "@/components/error-logs-table"
import type { StoredProject } from "@/lib/types"
import { Shield } from "lucide-react"

export default function App() {
  const [selectedProject, setSelectedProject] = useState<StoredProject | null>(
    null,
  )

  const handleProjectDeleted = useCallback(
    (projectId: string) => {
      if (selectedProject?.id === projectId) {
        setSelectedProject(null)
      }
    },
    [selectedProject],
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">AuraKeeper</h1>
        </div>
        <ProjectList
          selectedId={selectedProject?.id ?? null}
          onSelect={setSelectedProject}
          onProjectDeleted={handleProjectDeleted}
        />
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {selectedProject ? (
          <ErrorLogsTable project={selectedProject} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <Shield className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <h2 className="mt-4 text-lg font-medium text-muted-foreground">
                Select a project
              </h2>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Choose a project from the sidebar to view its error logs
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

import { useState, useCallback } from "react"
import { FolderOpen, Trash2, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CreateProjectDialog } from "@/components/create-project-dialog"
import { getProjects, removeProject } from "@/lib/storage"
import type { StoredProject } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ProjectListProps {
  selectedId: string | null
  onSelect: (project: StoredProject) => void
  onProjectDeleted: (projectId: string) => void
}

export function ProjectList({
  selectedId,
  onSelect,
  onProjectDeleted,
}: ProjectListProps) {
  const [projects, setProjects] = useState<StoredProject[]>(getProjects)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setProjects(getProjects())
  }, [])

  function handleCreated(project: StoredProject) {
    refresh()
    onSelect(project)
  }

  function handleRemove(e: React.MouseEvent<HTMLButtonElement>, project: StoredProject) {
    e.stopPropagation()
    removeProject(project.id)
    onProjectDeleted(project.id)
    refresh()
    toast.info(`Removed "${project.name}" from local storage`)
  }

  function handleCopyToken(e: React.MouseEvent<HTMLButtonElement>, project: StoredProject) {
    e.stopPropagation()
    navigator.clipboard.writeText(project.token)
    setCopiedId(project.id)
    toast.success("Token copied to clipboard")
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="p-3">
        <CreateProjectDialog onCreated={handleCreated} />
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-2">
          {projects.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              No projects yet
            </p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                onClick={() => onSelect(project)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  selectedId === project.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{project.name}</div>
                  {project.repair?.checkoutPath ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {project.repair.autoTrigger ? "Auto-fix on" : "Manual fix only"}
                    </div>
                  ) : null}
                </div>
                <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span onClick={(e) => e.stopPropagation()}>
                        <CreateProjectDialog project={project} onCreated={handleCreated} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">Edit project</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => handleCopyToken(e, project)}
                      >
                        {copiedId === project.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Copy API token</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={(e) => handleRemove(e, project)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Remove project</TooltipContent>
                  </Tooltip>
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

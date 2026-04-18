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
      <div className="p-4">
        <CreateProjectDialog onCreated={handleCreated} />
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-3">
          {projects.length === 0 ? (
            <p className="px-2 py-10 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase">
              No projects yet
            </p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                onClick={() => onSelect(project)}
                className={cn(
                  "group relative flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-300",
                  selectedId === project.id
                    ? "border-[#A855F7]/90 bg-[#A855F7]/26 text-sidebar-accent-foreground shadow-[0_0_24px_-12px_rgba(168,85,247,0.92)]"
                    : "border-white/10 bg-white/[0.02] text-sidebar-foreground hover:-translate-y-0.5 hover:border-[#A855F7]/65 hover:bg-white/[0.04]",
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-[#C084FC]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  {project.repair?.checkoutPath ? (
                    <div className="truncate font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                      {project.repair.agent ?? "codex"} • {project.repair.autoTrigger ? "Auto-fix on" : "Manual fix only"}
                    </div>
                  ) : null}
                </div>
                <span className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
                        className="h-8 w-8 min-h-0 min-w-0 border border-[#A855F7]/35"
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
                        className="h-8 w-8 min-h-0 min-w-0 border border-[#A855F7]/35 text-destructive hover:text-destructive"
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

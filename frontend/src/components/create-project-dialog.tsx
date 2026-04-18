import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createProject, updateProject } from "@/lib/api"
import { addProject } from "@/lib/storage"
import type { StoredProject } from "@/lib/types"

interface CreateProjectDialogProps {
  onCreated: (project: StoredProject) => void
  project?: StoredProject
}

export function CreateProjectDialog({ onCreated, project }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(project?.name ?? "")
  const [checkoutPath, setCheckoutPath] = useState(project?.repair?.checkoutPath ?? "")
  const [promotionMode, setPromotionMode] = useState<"auto" | "manual">(
    project?.repair?.promotionMode ?? "auto",
  )
  const [autoTrigger, setAutoTrigger] = useState(project?.repair?.autoTrigger ?? true)
  const isEditing = Boolean(project)

  const mutation = useMutation({
    mutationFn: (input: {
      name: string
      checkoutPath?: string
      promotionMode: "auto" | "manual"
      autoTrigger: boolean
    }) =>
      isEditing && project
        ? updateProject(project.id, {
            name: input.name,
            repair: input.checkoutPath
              ? {
                  checkoutPath: input.checkoutPath,
                  backend: project.repair?.backend ?? "local",
                  environment: project.repair?.environment ?? "local",
                  trustLevel: project.repair?.trustLevel ?? "trusted",
                  repositoryUrl: project.repair?.repositoryUrl,
                  baseCommit: project.repair?.baseCommit,
                  promotionMode: input.promotionMode,
                  autoTrigger: input.autoTrigger,
                }
              : null,
          })
        : createProject({
            name: input.name,
            repair: input.checkoutPath
              ? {
                  checkoutPath: input.checkoutPath,
                  backend: "local",
                  environment: "local",
                  trustLevel: "trusted",
                  promotionMode: input.promotionMode,
                  autoTrigger: input.autoTrigger,
                }
              : undefined,
          }),
    onSuccess: (project) => {
      addProject(project)
      onCreated(project)
      setOpen(false)
      setName(project.name)
      setCheckoutPath(project.repair?.checkoutPath ?? "")
      setPromotionMode(project.repair?.promotionMode ?? "auto")
      setAutoTrigger(project.repair?.autoTrigger ?? true)
      toast.success(
        isEditing ? `Project "${project.name}" updated` : `Project "${project.name}" created`,
        {
          description: isEditing
            ? "Repair settings have been saved locally."
            : "API token has been saved locally.",
        },
      )
    },
    onError: (error) => {
      toast.error(isEditing ? "Failed to update project" : "Failed to create project", {
        description: error.message,
      })
    },
  })

  function resetForm(nextOpen: boolean) {
    if (!nextOpen) {
      setName(project?.name ?? "")
      setCheckoutPath(project?.repair?.checkoutPath ?? "")
      setPromotionMode(project?.repair?.promotionMode ?? "auto")
      setAutoTrigger(project?.repair?.autoTrigger ?? true)
    }
    setOpen(nextOpen)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = name.trim()
    const trimmedCheckoutPath = checkoutPath.trim()
    if (!trimmed) return
    mutation.mutate({
      name: trimmed,
      checkoutPath: trimmedCheckoutPath || undefined,
      promotionMode,
      autoTrigger,
    })
  }

  return (
    <Dialog open={open} onOpenChange={resetForm}>
      <DialogTrigger asChild>
        {isEditing ? (
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit project" : "Create project"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the stored repair settings for this project."
                : "A new API token will be generated for this project."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              placeholder="e.g. aura-web"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2"
              autoFocus
              disabled={mutation.isPending}
            />

            <div className="mt-4">
              <Label htmlFor="project-checkout-path">Repair checkout path</Label>
              <Input
                id="project-checkout-path"
                placeholder="/absolute/path/to/repository"
                value={checkoutPath}
                onChange={(e) => setCheckoutPath(e.target.value)}
                className="mt-2"
                disabled={mutation.isPending}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional. Add a local repo path if AuraKeeper should be able to run fix agents for this project.
              </p>
            </div>

            <div className="mt-4">
              <Label htmlFor="project-promotion-mode">Verified patch apply mode</Label>
              <select
                id="project-promotion-mode"
                value={promotionMode}
                onChange={(e) => setPromotionMode(e.target.value as "auto" | "manual")}
                disabled={mutation.isPending || !checkoutPath.trim()}
                className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="auto">Auto apply after verify</option>
                <option value="manual">Manual apply after verify</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Auto applies the verified patch back to the original checkout. Manual keeps the verified patch ready for a later click.
              </p>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-md border p-3">
              <input
                type="checkbox"
                checked={autoTrigger}
                onChange={(e) => setAutoTrigger(e.target.checked)}
                disabled={mutation.isPending || !checkoutPath.trim()}
                className="mt-0.5 h-4 w-4"
              />
              <div>
                <div className="text-sm font-medium">Auto-run fixes for new errors</div>
                <p className="text-xs text-muted-foreground">
                  When enabled, newly ingested errors will immediately queue the fix pipeline for this project.
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || mutation.isPending}
            >
              {mutation.isPending
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

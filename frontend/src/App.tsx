import { useState, useCallback } from "react";
import { ProjectList } from "@/components/project-list";
import { ErrorLogsTable } from "@/components/error-logs-table";
import type { StoredProject } from "@/lib/types";
import { Shield } from "lucide-react";

export default function App() {
  const [selectedProject, setSelectedProject] = useState<StoredProject | null>(
    null,
  );

  const handleProjectDeleted = useCallback(
    (projectId: string) => {
      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
      }
    },
    [selectedProject],
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div className="bg-grid-pattern absolute inset-0 opacity-45" />
        <div className="void-noise absolute inset-0" />
        <div className="absolute -left-20 top-8 h-56 w-56 rounded-full bg-[#7C3AED]/35 blur-[120px]" />
        <div className="absolute right-4 top-0 h-72 w-72 rounded-full bg-[#C084FC]/25 blur-[150px]" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-80 rounded-full bg-[#A855F7]/35 blur-[150px]" />
      </div>

      <aside className="glass-panel relative z-10 flex w-80 shrink-0 flex-col border-r border-[#C084FC]/25 bg-sidebar/80">
        <div className="flex h-20 items-center gap-3 border-b border-[#C084FC]/20 px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#A855F7]/85 bg-[#7C3AED]/35 shadow-[0_0_20px_rgba(124,58,237,0.62)]">
            <Shield className="h-5 w-5 text-[#A855F7]" />
          </div>
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              Aura<span className="text-gradient-bitcoin">Keeper</span>
            </h1>
            <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
              Secure Runtime Ledger
            </p>
          </div>
        </div>
        <ProjectList
          selectedId={selectedProject?.id ?? null}
          onSelect={setSelectedProject}
          onProjectDeleted={handleProjectDeleted}
        />
      </aside>

      <main className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {selectedProject ? (
          <ErrorLogsTable project={selectedProject} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="glass-panel glow-soft mx-6 max-w-md rounded-2xl px-8 py-10 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#A855F7]/75 bg-[#7C3AED]/35 shadow-[0_0_24px_rgba(168,85,247,0.55)]">
                <Shield className="h-8 w-8 text-[#A855F7]" />
              </div>
              <h2 className="mt-5 font-heading text-2xl font-semibold text-foreground">
                Select a project
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Choose a project from the sidebar to view its error logs
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

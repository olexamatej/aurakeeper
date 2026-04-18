import type { StoredProject } from "./types"

const STORAGE_KEY = "aurakeeper_projects"

export function getProjects(): StoredProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addProject(project: StoredProject): void {
  const projects = getProjects()
  const existingIndex = projects.findIndex((entry) => entry.id === project.id)

  if (existingIndex >= 0) {
    projects[existingIndex] = project
  } else {
    projects.push(project)
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

export function removeProject(projectId: string): void {
  const projects = getProjects().filter((p) => p.id !== projectId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

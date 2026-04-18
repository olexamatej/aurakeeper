import type { ErrorLog, StoredProject } from "./types"

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000"
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? ""

class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({
      error: "unknown",
      message: response.statusText,
    }))
    throw new ApiError(response.status, body.error, body.message)
  }
  return response.json()
}

export async function createProject(name: string): Promise<StoredProject> {
  const response = await fetch(`${API_URL}/v1/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ name }),
  })
  return handleResponse<StoredProject>(response)
}

export async function listErrorLogs(apiToken: string): Promise<ErrorLog[]> {
  const response = await fetch(`${API_URL}/v1/logs/errors`, {
    headers: {
      "X-API-Token": apiToken,
    },
  })
  return handleResponse<ErrorLog[]>(response)
}

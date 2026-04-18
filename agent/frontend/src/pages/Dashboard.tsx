import { useEffect, useState, useCallback } from 'react'
import {
  Activity,
  Bot,
  GitPullRequest,
  CircleDot,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Wrench,
  Eye,
} from 'lucide-react'
import { useSettings } from '../components/SettingsProvider'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

// --- Types matching orchestrator state files ---

interface Worker {
  pid: number
  issue_number: number
  branch_name: string
  effort: string
  status: string
  started_at: string
  log_path: string
}

interface Reviewer {
  pid: number
  pr_number: number
  status: string
  started_at: string
}

interface FixWorker {
  pid: number
  pr_number: number
  status: string
  started_at: string
  log_path: string
}

interface AgentsState {
  workers: Worker[]
  reviewers: Reviewer[]
  fix_workers: FixWorker[]
}

interface IssueEntry {
  status: string
  updated_at: string
  url?: string
}

interface PrEntry {
  status: string
  updated_at: string
  url?: string
  summary?: string
}

type IssuesState = Record<string, IssueEntry>
type PrsState = Record<string, PrEntry>

interface DashboardState {
  agents: AgentsState
  issues: IssuesState
  prs: PrsState
  fetchedAt: Date | null
  error: string | null
}

const EMPTY: DashboardState = {
  agents: { workers: [], reviewers: [], fix_workers: [] },
  issues: {},
  prs: {},
  fetchedAt: null,
  error: null,
}

// --- Helpers ---

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'text-green-400'
    case 'finished':
      return 'text-muted-foreground'
    case 'merged':
      return 'text-purple-400'
    case 'claimed':
      return 'text-blue-400'
    case 'blocked':
      return 'text-red-400'
    case 'ready-for-review':
      return 'text-yellow-400'
    case 'needs-fix':
      return 'text-orange-400'
    default:
      return 'text-muted-foreground'
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Activity className="h-3.5 w-3.5 text-green-400" />
    case 'merged':
      return <CheckCircle2 className="h-3.5 w-3.5 text-purple-400" />
    case 'blocked':
      return <XCircle className="h-3.5 w-3.5 text-red-400" />
    case 'needs-fix':
      return <Wrench className="h-3.5 w-3.5 text-orange-400" />
    case 'ready-for-review':
      return <Eye className="h-3.5 w-3.5 text-yellow-400" />
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

// --- Components ---

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  accent?: string
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg bg-muted ${accent ?? ''}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function AgentsTable({ agents }: { agents: AgentsState }) {
  const rows = [
    ...agents.workers.map((w) => ({
      type: 'worker' as const,
      id: `#${w.issue_number}`,
      label: `Issue #${w.issue_number}`,
      branch: w.branch_name,
      status: w.status,
      started: w.started_at,
      effort: w.effort,
      pid: w.pid,
    })),
    ...agents.reviewers.map((r) => ({
      type: 'reviewer' as const,
      id: `PR #${r.pr_number}`,
      label: `PR #${r.pr_number}`,
      branch: '—',
      status: r.status,
      started: r.started_at,
      effort: '—',
      pid: r.pid,
    })),
    ...agents.fix_workers.map((f) => ({
      type: 'fix' as const,
      id: `PR #${f.pr_number} fix`,
      label: `PR #${f.pr_number} fix`,
      branch: '—',
      status: f.status,
      started: f.started_at,
      effort: '—',
      pid: f.pid,
    })),
  ]

  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No active agents. The orchestrator will spawn agents when issues are queued.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-left">
            <th className="pb-3 pr-4 font-medium">Type</th>
            <th className="pb-3 pr-4 font-medium">Target</th>
            <th className="pb-3 pr-4 font-medium">Branch</th>
            <th className="pb-3 pr-4 font-medium">Status</th>
            <th className="pb-3 pr-4 font-medium">Effort</th>
            <th className="pb-3 pr-4 font-medium">Started</th>
            <th className="pb-3 font-medium">PID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.type}-${row.pid}`} className="border-b border-border/50">
              <td className="py-3 pr-4">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-muted">
                  {row.type === 'worker' && <Bot className="h-3 w-3" />}
                  {row.type === 'reviewer' && <Eye className="h-3 w-3" />}
                  {row.type === 'fix' && <Wrench className="h-3 w-3" />}
                  {row.type}
                </span>
              </td>
              <td className="py-3 pr-4 font-medium text-foreground">{row.label}</td>
              <td className="py-3 pr-4">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.branch}</code>
              </td>
              <td className="py-3 pr-4">
                <span className={`inline-flex items-center gap-1.5 ${statusColor(row.status)}`}>
                  <StatusIcon status={row.status} />
                  {row.status}
                </span>
              </td>
              <td className="py-3 pr-4 text-muted-foreground">{row.effort}</td>
              <td className="py-3 pr-4 text-muted-foreground">{relativeTime(row.started)}</td>
              <td className="py-3 text-muted-foreground font-mono text-xs">{row.pid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ItemList({
  title,
  icon: Icon,
  items,
  prefix,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: Record<string, { status: string; updated_at: string; url?: string; summary?: string }>
  prefix: string
}) {
  const entries = Object.entries(items).sort(
    ([, a], [, b]) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  )

  if (entries.length === 0) {
    return null
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      <div className="space-y-2">
        {entries.map(([id, entry]) => (
          <div
            key={id}
            className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <StatusIcon status={entry.status} />
              <span className="font-medium text-foreground">
                {prefix}#{id}
              </span>
              <span className={`text-xs ${statusColor(entry.status)}`}>{entry.status}</span>
              {entry.summary && (
                <span className="text-xs text-muted-foreground truncate max-w-xs">
                  {entry.summary}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{relativeTime(entry.updated_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Main ---

export default function Dashboard() {
  const [state, setState] = useState<DashboardState>(EMPTY)
  const [refreshing, setRefreshing] = useState(false)
  const { settings } = useSettings()

  const fetchState = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const [agentsRes, issuesRes, prsRes] = await Promise.all([
        fetch(`${API_BASE}/api/state/agents`),
        fetch(`${API_BASE}/api/state/issues`),
        fetch(`${API_BASE}/api/state/prs`),
      ])

      if (!agentsRes.ok || !issuesRes.ok || !prsRes.ok) {
        setState((prev) => ({ ...prev, error: 'Failed to fetch state from API.' }))
        return
      }

      const [agents, issues, prs] = await Promise.all([
        agentsRes.json() as Promise<AgentsState>,
        issuesRes.json() as Promise<IssuesState>,
        prsRes.json() as Promise<PrsState>,
      ])

      setState({ agents, issues, prs, fetchedAt: new Date(), error: null })
    } catch {
      setState((prev) => ({
        ...prev,
        error: 'Cannot reach the API. Is the state server running?',
      }))
    } finally {
      if (manual) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchState()
    const id = setInterval(() => fetchState(), settings.dashboardPollSeconds * 1000)
    return () => clearInterval(id)
  }, [fetchState, settings.dashboardPollSeconds])

  const activeWorkers = state.agents.workers.filter((w) => w.status === 'running').length
  const activeReviewers = state.agents.reviewers.filter((r) => r.status === 'running').length
  const activeFixWorkers = state.agents.fix_workers.filter((f) => f.status === 'running').length
  const totalActive = activeWorkers + activeReviewers + activeFixWorkers

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Monitor running agents, issues, and pull requests
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.fetchedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {relativeTime(state.fetchedAt.toISOString())}
            </span>
          )}
          <button
            type="button"
            onClick={() => fetchState(true)}
            disabled={refreshing}
            className="p-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {state.error && (
        <div className="mb-8 flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Active agents" value={totalActive} icon={Bot} />
        <StatCard label="Issue workers" value={activeWorkers} icon={CircleDot} />
        <StatCard label="Reviewers" value={activeReviewers} icon={Eye} />
        <StatCard label="Fix workers" value={activeFixWorkers} icon={Wrench} />
      </div>

      {/* Agents table */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent" />
          Agents
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <AgentsTable agents={state.agents} />
        </div>
      </section>

      {/* Issues & PRs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          {Object.keys(state.issues).length > 0 ? (
            <ItemList title="Issues" icon={CircleDot} items={state.issues} prefix="Issue " />
          ) : (
            <>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <CircleDot className="h-4 w-4" />
                Issues
              </h3>
              <div className="flex flex-col items-center justify-center py-10 border border-border rounded-xl bg-card">
                <CircleDot className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No tracked issues yet.</p>
              </div>
            </>
          )}
        </section>
        <section>
          {Object.keys(state.prs).length > 0 ? (
            <ItemList title="Pull Requests" icon={GitPullRequest} items={state.prs} prefix="PR " />
          ) : (
            <>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <GitPullRequest className="h-4 w-4" />
                Pull Requests
              </h3>
              <div className="flex flex-col items-center justify-center py-10 border border-border rounded-xl bg-card">
                <GitPullRequest className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No tracked pull requests yet.</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

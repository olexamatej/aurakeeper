import {
  Sun,
  Moon,
  Monitor,
  Brain,
  Timer,
  Users,
  GitMerge,
  RotateCcw,
} from 'lucide-react'
import { useTheme } from '../components/ThemeProvider'
import { useSettings, type ThinkingLevel } from '../components/SettingsProvider'

const themeOptions = [
  { value: 'light' as const, icon: Sun, label: 'Light', description: 'Always use light theme' },
  { value: 'dark' as const, icon: Moon, label: 'Dark', description: 'Always use dark theme' },
  { value: 'system' as const, icon: Monitor, label: 'System', description: 'Follow your OS preference' },
]

const thinkingLevels: { value: ThinkingLevel; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Typo fixes, docs, small refactors' },
  { value: 'medium', label: 'Medium', description: 'Multi-file features, moderate bugs' },
  { value: 'high', label: 'High', description: 'Architectural work, migrations' },
  { value: 'xhigh', label: 'Extra High', description: 'Security, concurrency, ambiguous scope' },
]

function NumberSetting({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string
  description: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  unit: string
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (!isNaN(v) && v >= min && v <= max) onChange(v)
          }}
          min={min}
          max={max}
          step={step}
          className="w-20 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
        <span className="text-xs text-muted-foreground w-6">{unit}</span>
      </div>
    </div>
  )
}

function ToggleSetting({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          value ? 'bg-accent' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const { settings, updateSetting, resetSettings } = useSettings()

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure your account and preferences</p>
      </header>

      {/* Appearance */}
      <section className="mb-10">
        <SectionHeader icon={Sun} title="Appearance" description="Choose how AuraKeeper looks to you" />
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map(({ value, icon: Icon, label, description }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-5 transition-colors ${
                theme === value
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-6 w-6" />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground text-center">{description}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Default Thinking Level */}
      <section className="mb-10">
        <SectionHeader
          icon={Brain}
          title="Default Thinking Level"
          description="Set the default reasoning effort for new workers"
        />
        <div className="grid grid-cols-2 gap-3">
          {thinkingLevels.map(({ value, label, description }) => (
            <button
              key={value}
              onClick={() => updateSetting('defaultThinkingLevel', value)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-4 transition-colors text-left ${
                settings.defaultThinkingLevel === value
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground'
              }`}
            >
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Polling & Timing */}
      <section className="mb-10">
        <SectionHeader
          icon={Timer}
          title="Polling & Timing"
          description="Control how often data is fetched"
        />
        <div className="bg-card border border-border rounded-xl px-5">
          <NumberSetting
            label="Dashboard poll interval"
            description="How often the dashboard refreshes agent and issue state"
            value={settings.dashboardPollSeconds}
            onChange={(v) => updateSetting('dashboardPollSeconds', v)}
            min={5}
            max={300}
            step={5}
            unit="s"
          />
          <NumberSetting
            label="Orchestrator poll interval"
            description="How often the orchestrator checks for new issues and PRs"
            value={settings.orchestratorPollSeconds}
            onChange={(v) => updateSetting('orchestratorPollSeconds', v)}
            min={30}
            max={600}
            step={10}
            unit="s"
          />
        </div>
      </section>

      {/* Concurrency */}
      <section className="mb-10">
        <SectionHeader
          icon={Users}
          title="Concurrency"
          description="Limit how many agents run simultaneously"
        />
        <div className="bg-card border border-border rounded-xl px-5">
          <NumberSetting
            label="Max agents"
            description="Hard cap on total active agents (workers + reviewers + fix workers)"
            value={settings.maxAgents}
            onChange={(v) => updateSetting('maxAgents', v)}
            min={1}
            max={64}
            step={1}
            unit=""
          />
          <NumberSetting
            label="Issue worker soft cap"
            description="Soft limit on issue workers, reserving slots for reviewers and fixes"
            value={settings.issueWorkerSoftCap}
            onChange={(v) => updateSetting('issueWorkerSoftCap', v)}
            min={1}
            max={settings.maxAgents}
            step={1}
            unit=""
          />
        </div>
      </section>

      {/* Merge Behavior */}
      <section className="mb-10">
        <SectionHeader
          icon={GitMerge}
          title="Merge Behavior"
          description="Control how PRs are handled after review"
        />
        <div className="bg-card border border-border rounded-xl px-5">
          <ToggleSetting
            label="Auto-merge safe PRs"
            description="Automatically merge PRs that pass all checks and review criteria"
            value={settings.autoMerge}
            onChange={(v) => updateSetting('autoMerge', v)}
          />
        </div>
      </section>

      {/* Reset */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={resetSettings}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-lg hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </button>
      </div>
    </div>
  )
}

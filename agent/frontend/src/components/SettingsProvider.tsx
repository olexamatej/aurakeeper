import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh'

export interface AppSettings {
  /** Dashboard polling interval in seconds */
  dashboardPollSeconds: number
  /** Orchestrator polling interval in seconds */
  orchestratorPollSeconds: number
  /** Maximum concurrent agents */
  maxAgents: number
  /** Soft cap for issue workers */
  issueWorkerSoftCap: number
  /** Default thinking/reasoning level for workers */
  defaultThinkingLevel: ThinkingLevel
  /** Whether to auto-merge safe PRs */
  autoMerge: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  dashboardPollSeconds: 10,
  orchestratorPollSeconds: 60,
  maxAgents: 32,
  issueWorkerSoftCap: 28,
  defaultThinkingLevel: 'medium',
  autoMerge: true,
}

interface SettingsContextValue {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  resetSettings: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const STORAGE_KEY = 'aurakeeper-settings'

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch {
    // ignore corrupt data
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
  }, [])

  return (
    <SettingsContext value={{ settings, updateSetting, resetSettings }}>
      {children}
    </SettingsContext>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

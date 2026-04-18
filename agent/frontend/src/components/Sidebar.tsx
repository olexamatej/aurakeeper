import { NavLink } from 'react-router-dom'
import { Home, LayoutDashboard, CreditCard, Settings, Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from './ThemeProvider'

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const themeOptions = [
  { value: 'light' as const, icon: Sun, label: 'Light' },
  { value: 'dark' as const, icon: Moon, label: 'Dark' },
  { value: 'system' as const, icon: Monitor, label: 'System' },
]

export default function Sidebar() {
  const { theme, setTheme } = useTheme()

  return (
    <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <span className="text-lg font-semibold text-sidebar-accent-foreground tracking-tight">
          AuraKeeper
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-4">
        <div className="flex items-center rounded-lg bg-muted p-1 gap-0.5">
          {themeOptions.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              title={label}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                theme === value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

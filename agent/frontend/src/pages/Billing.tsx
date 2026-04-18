import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

const PLANS = [
  {
    id: 'monthly' as const,
    name: 'Monthly',
    price: 20,
    period: 'month',
    description: 'Billed monthly, cancel anytime.',
  },
  {
    id: 'yearly' as const,
    name: 'Yearly',
    price: 200,
    period: 'year',
    description: 'Billed annually. Save $40 per year.',
    badge: 'Save 17%',
  },
]

function isValidCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.stripe.com')
  } catch {
    return false
  }
}

export default function Billing() {
  const [selected, setSelected] = useState<'monthly' | 'yearly'>('yearly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCheckout = async () => {
    if (!API_BASE) {
      setError('API base URL is not configured. Set VITE_API_BASE in your environment.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selected }),
      })

      if (!res.ok) {
        setError('Failed to create checkout session.')
        return
      }

      const { url } = await res.json()

      if (!isValidCheckoutUrl(url)) {
        setError('Received an invalid checkout URL.')
        return
      }

      window.location.href = url
    } catch {
      setError('Failed to start checkout. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const selectedPlan = PLANS.find((p) => p.id === selected)!

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-foreground mb-1">Billing</h1>
        <p className="text-sm text-muted-foreground">Choose a plan that works for you</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelected(plan.id)}
            className={`relative text-left p-8 rounded-xl border-2 transition-all cursor-pointer ${
              selected === plan.id
                ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_0_24px_rgba(139,92,246,0.1)]'
                : 'border-border hover:border-muted-foreground/30 bg-card'
            }`}
          >
            {'badge' in plan && plan.badge && (
              <span className="absolute top-3 right-3 bg-accent/15 text-accent text-xs font-semibold px-2.5 py-1 rounded-full">
                {plan.badge}
              </span>
            )}
            <h2 className="text-lg font-semibold text-foreground mb-4">{plan.name}</h2>
            <div className="mb-3">
              <span className="text-4xl font-bold text-foreground tracking-tight">${plan.price}</span>
              <span className="text-base text-muted-foreground ml-1">/{plan.period}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{plan.description}</p>
            {plan.id === 'yearly' && (
              <p className="text-sm text-accent mt-2">~$16.67/month</p>
            )}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500 text-center mb-4">{error}</p>}

      <button
        type="button"
        onClick={handleCheckout}
        disabled={loading}
        className="w-full py-3.5 px-6 text-base font-semibold text-white bg-accent rounded-lg hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? 'Redirecting...' : `Subscribe — $${selectedPlan.price}/${selectedPlan.period}`}
      </button>
    </div>
  )
}

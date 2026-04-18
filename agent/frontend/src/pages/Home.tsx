export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero */}
      <section className="px-8 py-24 text-center">
        <span className="inline-block text-xs font-medium uppercase tracking-wider text-accent bg-accent/10 border border-accent/20 rounded-full px-4 py-1.5 mb-6">
          Self-evolving automation
        </span>
        <h1 className="text-5xl font-bold tracking-tight text-foreground mb-5 leading-tight">
          Your codebase maintains itself
        </h1>
        <p className="text-lg leading-relaxed max-w-xl mx-auto mb-9 text-muted-foreground">
          AuraKeeper is an autonomous harness that watches your GitHub issues,
          spins up isolated workers, and ships fixes — while you sleep.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <a
            className="inline-flex items-center text-sm font-medium px-7 py-3 rounded-lg bg-accent text-white border border-transparent hover:brightness-110 transition"
            href="https://github.com/olexamatej/aaurakeeper"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get started
          </a>
          <a
            className="inline-flex items-center text-sm font-medium px-7 py-3 rounded-lg bg-transparent text-foreground border border-border hover:border-accent/40 transition"
            href="https://github.com/olexamatej/aaurakeeper#readme"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the docs
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="px-8 py-16 bg-card border-t border-b border-border text-center">
        <h2 className="text-2xl font-bold text-foreground mb-10">How it works</h2>
        <div className="flex items-start justify-center gap-0 flex-wrap">
          <div className="max-w-60 text-center">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-accent text-white font-bold text-base flex items-center justify-center">
              1
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">Issue filed</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A new GitHub issue is opened in your repo. The orchestrator picks it up automatically.
            </p>
          </div>
          <div className="w-12 h-0.5 bg-border mt-5 shrink-0 hidden md:block" />
          <div className="max-w-60 text-center">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-accent text-white font-bold text-base flex items-center justify-center">
              2
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">Worker spawned</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              An isolated git worktree is created and a Claude Code agent is assigned to the task.
            </p>
          </div>
          <div className="w-12 h-0.5 bg-border mt-5 shrink-0 hidden md:block" />
          <div className="max-w-60 text-center">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-accent text-white font-bold text-base flex items-center justify-center">
              3
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">PR shipped</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The worker implements the fix, validates it, opens a PR, and comments on the issue.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-8 py-16 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-10">Built for autonomous delivery</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
          {[
            { icon: '\u{1F9F5}', title: 'Isolated worktrees', desc: 'Every task runs in its own git worktree. No conflicts, no shared state, no surprises.' },
            { icon: '\u{1F50D}', title: 'Issue-aware context', desc: 'Workers read the full issue discussion before writing a single line of code.' },
            { icon: '\u2699\uFE0F', title: 'Self-healing loop', desc: 'A supervisor daemon keeps the orchestrator alive, restarting it on failure.' },
            { icon: '\u{1F680}', title: 'PR-first workflow', desc: 'Every change lands as a pull request with validation results and a summary comment.' },
            { icon: '\u{1F512}', title: 'Scoped by design', desc: 'Workers never broaden scope. One issue, one branch, one PR \u2014 nothing more.' },
            { icon: '\u{1F4CA}', title: 'Observable', desc: 'Logs, state files, and GitHub comments give you full visibility into every decision.' },
          ].map((f) => (
            <div
              key={f.title}
              className="p-7 border border-border rounded-xl bg-card hover:border-accent/40 transition"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="text-base font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Terminal demo */}
      <section className="px-8 pb-20 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-8">One command to start</h2>
        <div className="max-w-xl mx-auto border border-border rounded-xl overflow-hidden text-left bg-card shadow-lg">
          <div className="flex gap-1.5 px-4 py-3 border-b border-border">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>
          <pre className="p-5 font-mono text-[13px] leading-7 overflow-x-auto">
            <code>
              <span className="text-muted-foreground">$</span>{' '}
              <span className="text-foreground font-semibold">npx aurakeeper start</span>
              {'\n\n'}
              <span className="text-accent">{'\u25C6'} supervisor</span> daemon started (pid 48201){'\n'}
              <span className="text-accent">{'\u25C6'} orchestrator</span> scanning olexamatej/aaurakeeper …{'\n'}
              <span className="text-green-500">{'\u2713'}</span> claimed issue #9 → branch <span className="text-accent">issue-9-homepage</span>
              {'\n'}
              <span className="text-green-500">{'\u2713'}</span> worker spawned in worktree <span className="text-accent">.claude/worktrees/issue-9</span>
              {'\n'}
              <span className="text-green-500">{'\u2713'}</span> PR #10 opened → waiting for review
            </code>
          </pre>
        </div>
      </section>

      {/* CTA */}
      <section className="px-8 py-20 bg-card border-t border-border text-center">
        <h2 className="text-2xl font-bold text-foreground mb-3">Stop triaging. Start shipping.</h2>
        <p className="text-muted-foreground mb-7">
          Let AuraKeeper handle the routine work so you can focus on what matters.
        </p>
        <a
          className="inline-flex items-center text-sm font-medium px-7 py-3 rounded-lg bg-accent text-white border border-transparent hover:brightness-110 transition"
          href="https://github.com/olexamatej/aaurakeeper"
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub
        </a>
      </section>

      {/* Footer */}
      <footer className="px-8 py-6 border-t border-border mt-auto">
        <p className="text-xs text-muted-foreground">
          AuraKeeper — open source, self-evolving GitHub automation.
        </p>
      </footer>
    </div>
  )
}

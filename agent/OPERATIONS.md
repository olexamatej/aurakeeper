# Repository Operations Runbook

This repository is intended to be managed by a long-running supervisor process that continuously pulls work from GitHub, delegates implementation to isolated worker agents, and drives PRs to merge.

## Bootstrap sequence

If the repository is still empty, complete this bootstrap before the autonomous loop runs:

1. Create an initial commit on `main`.
2. Push `main` to GitHub.
3. Enable branch protection for `main`.
4. Create the labels listed below.
5. Confirm `gh auth status` works on the control machine.
6. Confirm `claude` is installed on the control machine.

Without an initial default branch, workers cannot branch cleanly and PR automation will fail.

## Operating model

Use three roles:

- `Supervisor`: polls GitHub issues, decides what to work on, and spawns worker agents.
- `Worker`: handles exactly one issue in an isolated worktree and must open a PR before exiting.
- `Reviewer`: continuously polls for ready PRs, reviews them, and either merges or dispatches a fix worker.

Run the supervisor and reviewer on a persistent machine inside `tmux`, `screen`, `launchd`, `systemd`, or another long-lived process manager. A chat session is not a reliable 10-hour runtime boundary.

For this repository, the intended operator is Codex. The user should only need to type `<start>` to Codex, and Codex should launch the local supervisor entrypoint on the user's behalf.

## Required labels

Create these labels in GitHub:

- `orchestrator:queued`
- `orchestrator:claimed`
- `orchestrator:blocked`
- `orchestrator:ready-for-review`
- `orchestrator:needs-fix`
- `orchestrator:merged`
- `priority:low`
- `priority:medium`
- `priority:high`
- `complexity:low`
- `complexity:medium`
- `complexity:high`

Optional but useful:

- `type:bug`
- `type:feature`
- `type:chore`
- `type:docs`

## Directory layout on the control machine

Use a stable local layout:

```text
aurakeeper/
worktrees/
logs/
state/
```

Suggested paths:

- repo root: `/path/to/aurakeeper`
- worker worktrees: `/path/to/worktrees/issue-<number>`
- logs: `/path/to/logs`
- supervisor state files: `/path/to/state`

## Concurrency rules

- Never run more than 32 workers at once.
- Reserve 1 slot for the reviewer loop.
- Reserve 1-2 slots for remediation workers created from PR review.
- Prefer a soft cap of 28 issue workers and hard cap of 32 total active agents.
- Do not spawn two workers for the same issue.
- Do not spawn a new fix worker for a PR if another fix worker is already assigned.

Track active agents in a local state file keyed by issue number or PR number.

## Complexity to thinking mapping

Assign worker effort before spawning:

- `complexity:low`: typo fixes, docs, small refactors, narrow bug fixes. Use low/medium reasoning.
- `complexity:medium`: multi-file feature work, moderate bug fixes, targeted tests. Use medium/high reasoning.
- `complexity:high`: architectural work, migrations, concurrency, security, unclear acceptance criteria. Use high/xhigh reasoning.

Heuristics:

- If the issue changes 1-2 files and has clear acceptance criteria, treat it as low.
- If the issue likely changes 3-8 files or needs new tests, treat it as medium.
- If the issue touches core architecture, persistence, deployment, or ambiguous requirements, treat it as high.

## Issue polling loop

Poll every 60-120 seconds. Each cycle:

1. Fetch open issues that are not already claimed.
2. Skip issues with open linked PRs.
3. Skip issues labeled `orchestrator:blocked`.
4. Sort by priority first, then oldest update time.
5. Spawn workers until capacity is full.
6. Label claimed issues with `orchestrator:claimed`.
7. Post a comment naming the assigned worker and local branch/worktree.

Example issue query:

```bash
gh issue list \
  --state open \
  --limit 100 \
  --json number,title,labels,updatedAt,assignees,url
```

Recommended claim rules:

- Only claim issues with enough detail to act.
- If requirements are incomplete, comment with questions and mark `orchestrator:blocked`.
- If an issue duplicates another, link and close or mark blocked.

## Worker launch contract

Spawn one worker per issue with an isolated worktree. The requested launch shape is:

```bash
claude --dangerously-skip-permissions --worktree issue-<number>
```

Wrap that with a supervisor script that ensures the worktree exists and the agent receives a concrete brief. Recommended branch name:

```text
issue-<number>-<slug>
```

Recommended worker prompt:

```text
You own GitHub issue #<number> in repository <owner>/<repo>.

Rules:
- Work only on this issue.
- Use the existing issue description and linked discussion as the source of truth.
- Implement the change in your isolated worktree.
- Run the relevant tests or validation commands.
- Commit your work to a dedicated branch.
- Open a PR against main before exiting.
- Comment on the issue with the PR URL and a short implementation summary.
- If blocked, comment on the issue with the blocker and stop.
- Do not broaden scope beyond the issue.

Deliverables before exit:
- local branch pushed
- PR opened
- issue updated with status
```

Each worker must also capture:

- issue number
- branch name
- worktree path
- PR URL
- test results
- final status: `opened_pr`, `blocked`, or `failed`

## PR polling and review loop

Run a dedicated reviewer loop every 60-120 seconds.

Poll for open PRs that are ready for review:

```bash
gh pr list \
  --state open \
  --search 'draft:false' \
  --limit 100 \
  --json number,title,author,headRefName,reviewDecision,mergeStateStatus,isDraft,url
```

Review decision rules:

- Merge directly if checks are green, diff matches the issue, and there are no material risks.
- Request fixes if requirements are unmet, tests are missing, or the change is unsafe.
- Close stale or duplicate PRs only with a clear issue comment.

Reviewer checklist:

1. Read the linked issue and PR body.
2. Inspect changed files.
3. Check CI status and required checks.
4. Validate branch is mergeable.
5. Scan for missing tests, obvious regressions, secrets, and scope creep.
6. Decide `merge` or `needs-fix`.

Safe merge command:

```bash
gh pr merge <number> --squash --delete-branch
```

After merge:

- label linked issue `orchestrator:merged`
- close the issue if the PR did not auto-close it
- remove `orchestrator:claimed`
- append an audit log entry locally

## Fix-worker flow

If review finds actionable problems, spawn a remediation worker instead of leaving the PR idle.

Use a separate worktree and a prompt tied to the PR:

```text
You own follow-up fixes for PR #<number> linked to issue #<issue>.

Review findings to address:
- <finding 1>
- <finding 2>

Requirements:
- work from the PR branch or a branch derived from it
- address only the listed findings
- run validation
- push updates to the PR branch
- comment on the PR summarizing the fixes
```

Label the PR or linked issue with `orchestrator:needs-fix` while remediation is active.

## Failure handling

Handle failures explicitly:

- If a worker crashes before opening a PR, remove `orchestrator:claimed` and requeue the issue.
- If a worker fails repeatedly 3 times, mark `orchestrator:blocked` and comment with the failure reason.
- If GitHub API calls fail, back off exponentially and retry.
- If `claude` exits non-zero, capture stderr to logs and do not silently respawn in a tight loop.
- If the reviewer cannot determine safety, do not merge automatically.

## Logging and state

Maintain local machine-readable state:

- `state/agents.json`
- `state/issues.json`
- `state/prs.json`

Log every transition:

- issue claimed
- worker started
- worker finished
- PR opened
- PR reviewed
- PR merged
- PR sent for fixes
- issue blocked

Include timestamps in UTC and absolute GitHub URLs.

## Practical merge policy

Do not allow automatic merge if any of the following are true:

- required checks are failing or absent
- PR is still draft
- linked issue is ambiguous or unresolved
- PR changes infrastructure, auth, billing, secrets, or destructive migrations
- reviewer found missing tests for behavior changes
- merge would exceed the intended scope of the issue

Default to human escalation for security-sensitive or production-sensitive changes.

## Suggested supervisor pseudocode

```text
loop:
  refresh local state
  refresh active worker count
  poll open issues
  for each eligible issue by priority:
    if active_workers >= 32:
      break
    classify complexity
    spawn worker with mapped reasoning
    mark claimed
  poll ready PRs
  for each eligible PR:
    review
    if safe:
      merge
    else if actionable:
      spawn fix worker unless one already exists
    else:
      mark blocked
  sleep 60-120s
```

## Minimum human checkpoints

Even in autonomous mode, require a human checkpoint for:

- first production deployment
- secrets handling
- permission model changes
- data migrations
- deleting code paths or infrastructure
- force pushes or history rewrites

## Startup checklist

Before typing `<start>`, confirm:

1. `main` exists on GitHub and is protected.
2. `gh auth status` succeeds.
3. `claude --help` succeeds.
4. labels are present.
5. worker and reviewer logs have writable directories.
6. there are fewer than 32 active agents.
7. merge policy is configured.

## Expected supervisor instruction

When starting the workflow, the supervisor should interpret `<start>` as:

```text
Begin the continuous issue and PR polling loops.
Claim eligible issues.
Spawn at most 32 total agents.
Map task complexity to agent reasoning.
Require every worker to open a PR before exiting.
Review ready PRs continuously.
Merge safe PRs.
Spawn remediation workers for fixable review findings.
Continue until stopped externally.
```

## Important limitation

The 10-hour autonomous requirement is operational, not conversational. It must be implemented as a persistent process on the control machine. A single interactive assistant turn cannot guarantee uninterrupted execution for 10 hours, so use this runbook as the repository policy and wire it into scripts or a service supervisor.

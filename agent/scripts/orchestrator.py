#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LOGS_DIR = ROOT / "logs"
STATE_DIR = ROOT / "state"
WORKTREES_DIR = ROOT / "worktrees"
SUPERVISOR_LOG = LOGS_DIR / "supervisor.log"
PID_FILE = STATE_DIR / "supervisor.pid"
AGENTS_FILE = STATE_DIR / "agents.json"
ISSUES_FILE = STATE_DIR / "issues.json"
PRS_FILE = STATE_DIR / "prs.json"
DEFAULTS = {
    "poll_seconds": 60,
    "max_agents": 32,
    "issue_worker_soft_cap": 28,
    "base_branch": "main",
    "labels": [
        "orchestrator:queued",
        "orchestrator:claimed",
        "orchestrator:blocked",
        "orchestrator:ready-for-review",
        "orchestrator:needs-fix",
        "orchestrator:merged",
        "priority:low",
        "priority:medium",
        "priority:high",
        "complexity:low",
        "complexity:medium",
        "complexity:high",
        "type:bug",
        "type:feature",
        "type:chore",
        "type:docs",
    ],
}
LABEL_COLORS = {
    "orchestrator:queued": "d4c5f9",
    "orchestrator:claimed": "0366d6",
    "orchestrator:blocked": "b60205",
    "orchestrator:ready-for-review": "0e8a16",
    "orchestrator:needs-fix": "fbca04",
    "orchestrator:merged": "5319e7",
    "priority:low": "c2e0c6",
    "priority:medium": "fbca04",
    "priority:high": "b60205",
    "complexity:low": "c2e0c6",
    "complexity:medium": "fbca04",
    "complexity:high": "b60205",
    "type:bug": "d73a4a",
    "type:feature": "a2eeef",
    "type:chore": "ededed",
    "type:docs": "0075ca",
}
REVIEW_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "action": {"enum": ["merge", "fix", "block"]},
            "summary": {"type": "string"},
            "findings": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["action", "summary", "findings"],
    }
)


@dataclass
class RepoRef:
    owner: str
    name: str

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.name}"


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_runtime_dirs() -> None:
    LOGS_DIR.mkdir(exist_ok=True)
    STATE_DIR.mkdir(exist_ok=True)
    WORKTREES_DIR.mkdir(exist_ok=True)
    for path, default in (
        (AGENTS_FILE, {"workers": [], "reviewers": [], "fix_workers": []}),
        (ISSUES_FILE, {}),
        (PRS_FILE, {}),
    ):
        if not path.exists():
            write_json(path, default)


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open() as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(exist_ok=True)
    with path.open("w") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def run(cmd: list[str], *, capture: bool = True, check: bool = True, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        capture_output=capture,
        check=check,
    )


def run_json(cmd: list[str], *, cwd: Path = ROOT) -> Any:
    result = run(cmd, cwd=cwd)
    return json.loads(result.stdout or "null")


def repo_ref() -> RepoRef:
    payload = run_json(["gh", "repo", "view", "--json", "name,owner"])
    return RepoRef(owner=payload["owner"]["login"], name=payload["name"])


def slugify(text: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return value[:48] or "task"


def git_remote_branch_exists(branch: str) -> bool:
    result = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    return result.returncode == 0


def gh_issue_list() -> list[dict[str, Any]]:
    return run_json(
        [
            "gh",
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,labels,updatedAt,url",
        ]
    )


def gh_pr_list() -> list[dict[str, Any]]:
    return run_json(
        [
            "gh",
            "pr",
            "list",
            "--state",
            "open",
            "--search",
            "draft:false",
            "--limit",
            "100",
            "--json",
            "number,title,isDraft,labels,mergeStateStatus,reviewDecision,url,headRefName,updatedAt",
        ]
    )


def gh_pr_view(number: int) -> dict[str, Any]:
    return run_json(
        [
            "gh",
            "pr",
            "view",
            str(number),
            "--json",
            "number,title,body,author,isDraft,labels,mergeStateStatus,reviewDecision,url,headRefName,headRefOid,statusCheckRollup,closingIssuesReferences,mergedAt",
        ]
    )


def issue_label_names(issue: dict[str, Any]) -> set[str]:
    return {label["name"] for label in issue.get("labels", [])}


def priority_rank(labels: set[str]) -> int:
    if "priority:high" in labels:
        return 0
    if "priority:medium" in labels:
        return 1
    return 2


def complexity_effort(issue: dict[str, Any]) -> tuple[str, str]:
    labels = issue_label_names(issue)
    if "complexity:high" in labels:
        return "high", "high"
    if "complexity:low" in labels or "type:docs" in labels:
        return "low", "medium"
    body = (issue.get("body") or "").lower()
    title = (issue.get("title") or "").lower()
    if any(token in title for token in ("docs", "readme", "typo")):
        return "low", "medium"
    if any(token in body for token in ("migration", "security", "architecture", "concurrency")):
        return "high", "max"
    return "medium", "medium"


def sort_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(issues, key=lambda issue: (priority_rank(issue_label_names(issue)), issue["updatedAt"]))


def comment_issue(number: int, body: str) -> None:
    run(["gh", "issue", "comment", str(number), "--body", body], capture=True)


def comment_pr(number: int, body: str) -> None:
    run(["gh", "pr", "comment", str(number), "--body", body], capture=True)


def set_issue_labels(number: int, add: list[str] | None = None, remove: list[str] | None = None) -> None:
    add = add or []
    remove = remove or []
    if add:
        run(["gh", "issue", "edit", str(number), "--add-label", ",".join(add)], capture=True)
    if remove:
        subprocess.run(
            ["gh", "issue", "edit", str(number), "--remove-label", ",".join(remove)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )


def set_pr_labels(number: int, add: list[str] | None = None, remove: list[str] | None = None) -> None:
    add = add or []
    remove = remove or []
    if add:
        run(["gh", "pr", "edit", str(number), "--add-label", ",".join(add)], capture=True)
    if remove:
        subprocess.run(
            ["gh", "pr", "edit", str(number), "--remove-label", ",".join(remove)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )


def audit(message: str) -> None:
    line = f"[{now_utc()}] {message}\n"
    with SUPERVISOR_LOG.open("a") as handle:
        handle.write(line)


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def sync_agent_state() -> dict[str, Any]:
    state = read_json(AGENTS_FILE, {"workers": [], "reviewers": [], "fix_workers": []})
    changed = False
    for bucket in ("workers", "reviewers", "fix_workers"):
        for agent in state[bucket]:
            pid = agent.get("pid")
            if agent.get("status") == "running" and pid and not pid_alive(pid):
                agent["status"] = "finished"
                agent["finished_at"] = now_utc()
                changed = True
        state[bucket] = [agent for agent in state[bucket] if agent.get("status") == "running"]
    if changed:
        write_json(AGENTS_FILE, state)
    else:
        write_json(AGENTS_FILE, state)
    return state


def active_agent_count(state: dict[str, Any]) -> int:
    return sum(len(state[bucket]) for bucket in ("workers", "reviewers", "fix_workers"))


def issue_claimed(issue_number: int, state: dict[str, Any]) -> bool:
    return any(agent.get("issue_number") == issue_number for agent in state["workers"])


def pr_has_fix_worker(pr_number: int, state: dict[str, Any]) -> bool:
    return any(agent.get("pr_number") == pr_number for agent in state["fix_workers"])


def start_process(cmd: list[str], log_path: Path, env: dict[str, str] | None = None) -> subprocess.Popen[str]:
    log_path.parent.mkdir(exist_ok=True)
    handle = log_path.open("a")
    return subprocess.Popen(cmd, cwd=ROOT, stdout=handle, stderr=subprocess.STDOUT, text=True, env=env)


def spawn_issue_worker(issue: dict[str, Any], repo: RepoRef, state: dict[str, Any]) -> None:
    complexity, effort = complexity_effort(issue)
    issue_number = issue["number"]
    branch_name = f"issue-{issue_number}-{slugify(issue['title'])}"
    prompt = f"""
You own GitHub issue #{issue_number} in repository {repo.slug}.

Follow this contract:
- work only on issue #{issue_number}
- use an isolated worktree created by this session
- create or switch to branch {branch_name}
- inspect the issue with gh before editing
- implement only the issue scope
- run the smallest relevant validation
- push your branch
- open a PR against main before exiting
- comment on the issue with the PR URL, validation results, and a short summary
- if blocked, comment on the issue with the blocker and stop

Complexity: {complexity}
Thinking effort target: {effort}
""".strip()
    cmd = [
        "claude",
        "--dangerously-skip-permissions",
        "--worktree",
        f"issue-{issue_number}",
        "--effort",
        effort,
        "--print",
        prompt,
    ]
    log_path = LOGS_DIR / f"issue-{issue_number}.log"
    process = start_process(cmd, log_path, env=os.environ.copy())
    state["workers"].append(
        {
            "pid": process.pid,
            "issue_number": issue_number,
            "branch_name": branch_name,
            "effort": effort,
            "status": "running",
            "started_at": now_utc(),
            "log_path": str(log_path),
        }
    )
    write_json(AGENTS_FILE, state)
    set_issue_labels(issue_number, add=["orchestrator:claimed"], remove=["orchestrator:queued"])
    comment_issue(
        issue_number,
        "\n".join(
            [
                "AuraKeeper supervisor claimed this issue.",
                f"- branch target: `{branch_name}`",
                f"- worker pid: `{process.pid}`",
                f"- effort: `{effort}`",
            ]
        ),
    )
    audit(f"spawned issue worker for #{issue_number} pid={process.pid} effort={effort}")


def review_prompt(repo: RepoRef, pr: dict[str, Any]) -> str:
    linked = ", ".join(f"#{issue['number']}" for issue in pr.get("closingIssuesReferences", [])) or "none"
    return f"""
Review GitHub PR #{pr['number']} in repository {repo.slug}.

Rules:
- inspect the PR with gh
- inspect the linked issue if there is one
- review changed files, status checks, and overall scope
- do not edit files
- decide whether this PR is safe to merge now, needs a fix worker, or needs to stay blocked for humans

Merge only if:
- the change matches the linked issue scope
- required validation is present and green
- no obvious regression or security risk is visible

Return only JSON matching the provided schema.

Linked issues: {linked}
""".strip()


def run_reviewer(repo: RepoRef, pr_number: int) -> dict[str, Any]:
    prompt = review_prompt(repo, gh_pr_view(pr_number))
    result = run(
        [
            "claude",
            "--dangerously-skip-permissions",
            "--effort",
            "medium",
            "--print",
            "--output-format",
            "json",
            "--json-schema",
            REVIEW_SCHEMA,
            prompt,
        ]
    )
    payload = json.loads(result.stdout)
    if isinstance(payload, dict) and isinstance(payload.get("structured_output"), dict):
        return payload["structured_output"]
    return payload


def checks_green(pr: dict[str, Any]) -> bool:
    rollup = pr.get("statusCheckRollup") or []
    if not rollup:
        return False
    for item in rollup:
        if item.get("conclusion") not in ("SUCCESS", "NEUTRAL", "SKIPPED"):
            return False
    return True


def merge_pr(pr_number: int) -> None:
    result = subprocess.run(
        ["gh", "pr", "merge", str(pr_number), "--squash", "--delete-branch"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if result.returncode == 0:
        return
    pr = gh_pr_view(pr_number)
    if pr.get("mergedAt"):
        audit(f"merge command returned non-zero after PR #{pr_number} was already merged: {result.stderr.strip()}")
        return
    raise RuntimeError(result.stderr.strip() or f"failed to merge PR #{pr_number}")


def spawn_fix_worker(repo: RepoRef, pr: dict[str, Any], findings: list[str], state: dict[str, Any]) -> None:
    pr_number = pr["number"]
    finding_lines = "\n".join(f"- {finding}" for finding in findings) or "- reviewer requested follow-up changes"
    prompt = f"""
You own remediation work for PR #{pr_number} in repository {repo.slug}.

Review findings:
{finding_lines}

Requirements:
- inspect the PR with gh
- use an isolated worktree
- check out the PR branch or a branch derived from it
- fix only the listed findings
- run the smallest relevant validation
- push updates to the PR branch
- comment on the PR with a short fix summary and validation results
""".strip()
    cmd = [
        "claude",
        "--dangerously-skip-permissions",
        "--worktree",
        f"pr-{pr_number}-fix",
        "--effort",
        "medium",
        "--print",
        prompt,
    ]
    log_path = LOGS_DIR / f"pr-{pr_number}-fix.log"
    process = start_process(cmd, log_path, env=os.environ.copy())
    state["fix_workers"].append(
        {
            "pid": process.pid,
            "pr_number": pr_number,
            "status": "running",
            "started_at": now_utc(),
            "log_path": str(log_path),
        }
    )
    write_json(AGENTS_FILE, state)
    set_pr_labels(pr_number, add=["orchestrator:needs-fix"], remove=["orchestrator:ready-for-review"])
    comment_pr(pr_number, "AuraKeeper started a remediation worker for this PR.")
    audit(f"spawned fix worker for PR #{pr_number} pid={process.pid}")


def refresh_issue_state(issue_number: int, status: str, payload: dict[str, Any] | None = None) -> None:
    issues = read_json(ISSUES_FILE, {})
    issues[str(issue_number)] = {"status": status, "updated_at": now_utc(), **(payload or {})}
    write_json(ISSUES_FILE, issues)


def refresh_pr_state(pr_number: int, status: str, payload: dict[str, Any] | None = None) -> None:
    prs = read_json(PRS_FILE, {})
    prs[str(pr_number)] = {"status": status, "updated_at": now_utc(), **(payload or {})}
    write_json(PRS_FILE, prs)


def issue_poll_cycle(repo: RepoRef) -> None:
    state = sync_agent_state()
    if active_agent_count(state) >= DEFAULTS["max_agents"]:
        audit("agent cap reached; skipping issue polling cycle")
        return
    workers_running = len(state["workers"])
    if workers_running >= DEFAULTS["issue_worker_soft_cap"]:
        audit("issue worker soft cap reached; skipping issue polling cycle")
        return
    for issue in sort_issues(gh_issue_list()):
        labels = issue_label_names(issue)
        issue_number = issue["number"]
        if active_agent_count(state) >= DEFAULTS["max_agents"]:
            break
        if len(state["workers"]) >= DEFAULTS["issue_worker_soft_cap"]:
            break
        if issue_claimed(issue_number, state):
            continue
        if "orchestrator:claimed" in labels or "orchestrator:blocked" in labels or "orchestrator:merged" in labels:
            continue
        spawn_issue_worker(issue, repo, state)
        refresh_issue_state(issue_number, "claimed", {"url": issue["url"]})
        state = sync_agent_state()


def pr_poll_cycle(repo: RepoRef) -> None:
    state = sync_agent_state()
    for summary in sorted(gh_pr_list(), key=lambda pr: pr["number"]):
        pr_number = summary["number"]
        labels = {label["name"] for label in summary.get("labels", [])}
        if summary.get("isDraft"):
            continue
        if pr_has_fix_worker(pr_number, state):
            continue
        pr = gh_pr_view(pr_number)
        if not checks_green(pr):
            refresh_pr_state(pr_number, "waiting-for-checks", {"url": pr["url"]})
            continue
        verdict = run_reviewer(repo, pr_number)
        if "action" not in verdict:
            raise RuntimeError(f"reviewer returned unexpected payload for PR #{pr_number}: {verdict}")
        refresh_pr_state(pr_number, verdict["action"], {"url": pr["url"], "summary": verdict["summary"]})
        if verdict["action"] == "merge":
            try:
                run(["gh", "pr", "review", str(pr_number), "--approve", "--body", verdict["summary"]], capture=True)
            except subprocess.CalledProcessError:
                pass
            merge_pr(pr_number)
            set_pr_labels(pr_number, add=["orchestrator:merged"], remove=["orchestrator:needs-fix", "orchestrator:ready-for-review"])
            for issue in pr.get("closingIssuesReferences", []):
                set_issue_labels(issue["number"], add=["orchestrator:merged"], remove=["orchestrator:claimed"])
                refresh_issue_state(issue["number"], "merged", {"pr_number": pr_number})
            audit(f"merged PR #{pr_number}")
        elif verdict["action"] == "fix":
            body = "\n".join(["AuraKeeper reviewer requested follow-up changes.", "", *[f"- {finding}" for finding in verdict["findings"]]])
            try:
                run(["gh", "pr", "review", str(pr_number), "--request-changes", "--body", body], capture=True)
            except subprocess.CalledProcessError:
                comment_pr(pr_number, body)
            spawn_fix_worker(repo, pr, verdict["findings"], state)
            state = sync_agent_state()
        else:
            set_pr_labels(pr_number, add=["orchestrator:needs-fix"], remove=["orchestrator:ready-for-review"])
            comment_pr(pr_number, f"AuraKeeper review blocked automatic merge.\n\n{verdict['summary']}")
            audit(f"blocked PR #{pr_number}: {verdict['summary']}")


def loop_forever() -> None:
    ensure_runtime_dirs()
    repo = repo_ref()
    audit(f"supervisor started for {repo.slug}")
    while True:
        try:
            issue_poll_cycle(repo)
            pr_poll_cycle(repo)
        except Exception as exc:  # noqa: BLE001
            audit(f"loop error: {exc}")
        time.sleep(DEFAULTS["poll_seconds"])


def bootstrap_github() -> None:
    ensure_runtime_dirs()
    repo = repo_ref()
    for label in DEFAULTS["labels"]:
        color = LABEL_COLORS.get(label, "ededed")
        result = subprocess.run(
            ["gh", "label", "create", label, "--color", color, "--force"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"failed to create label {label}")
    if git_remote_branch_exists(DEFAULTS["base_branch"]):
        protection = {
            "required_status_checks": {
                "strict": True,
                "contexts": ["validate"],
            },
            "enforce_admins": False,
            "required_pull_request_reviews": None,
            "restrictions": None,
            "allow_force_pushes": False,
            "allow_deletions": False,
            "block_creations": False,
            "required_conversation_resolution": False,
            "lock_branch": False,
            "allow_fork_syncing": True,
        }
        result = subprocess.run(
            [
                "gh",
                "api",
                "-X",
                "PUT",
                f"repos/{repo.slug}/branches/{DEFAULTS['base_branch']}/protection",
                "--input",
                "-",
            ],
            cwd=ROOT,
            input=json.dumps(protection),
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            audit(f"branch protection not applied automatically: {result.stderr.strip()}")
    audit("bootstrap-github completed")


def branch_ready() -> bool:
    return git_remote_branch_exists(DEFAULTS["base_branch"])


def status() -> int:
    ensure_runtime_dirs()
    state = sync_agent_state()
    pid = PID_FILE.read_text().strip() if PID_FILE.exists() else ""
    if pid and pid.isdigit() and pid_alive(int(pid)):
        daemon = f"running (pid {pid})"
    else:
        daemon = "stopped"
    repo = repo_ref()
    print(f"repo: {repo.slug}")
    print(f"base branch ready: {'yes' if branch_ready() else 'no'}")
    print(f"daemon: {daemon}")
    print(f"active workers: {len(state['workers'])}")
    print(f"active reviewers: {len(state['reviewers'])}")
    print(f"active fix workers: {len(state['fix_workers'])}")
    return 0


def stop() -> int:
    if not PID_FILE.exists():
        print("supervisor not running")
        return 0
    pid_text = PID_FILE.read_text().strip()
    if not pid_text.isdigit():
        print("invalid pid file")
        return 1
    pid = int(pid_text)
    if pid_alive(pid):
        os.kill(pid, signal.SIGTERM)
        print(f"stopped supervisor pid {pid}")
    else:
        print("supervisor already stopped")
    PID_FILE.unlink(missing_ok=True)
    return 0


def start(detach: bool) -> int:
    ensure_runtime_dirs()
    if not branch_ready():
        print("base branch main is not available on origin; push the initial commit first", file=sys.stderr)
        return 1
    if PID_FILE.exists():
        pid_text = PID_FILE.read_text().strip()
        if pid_text.isdigit() and pid_alive(int(pid_text)):
            print(f"supervisor already running with pid {pid_text}")
            return 0
        PID_FILE.unlink(missing_ok=True)
    if detach:
        with SUPERVISOR_LOG.open("a") as handle:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "serve"],
                cwd=ROOT,
                stdout=handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                text=True,
            )
        PID_FILE.write_text(f"{process.pid}\n")
        print(f"started supervisor pid {process.pid}")
        print(f"log: {SUPERVISOR_LOG}")
        return 0
    PID_FILE.write_text(f"{os.getpid()}\n")
    loop_forever()
    return 0


def serve() -> int:
    ensure_runtime_dirs()
    if not branch_ready():
        print("base branch main is not available on origin; push the initial commit first", file=sys.stderr)
        return 1
    PID_FILE.write_text(f"{os.getpid()}\n")
    loop_forever()
    return 0


def init_git() -> None:
    run(["git", "add", "."], capture=True)
    run(["git", "commit", "-m", "Bootstrap AuraKeeper supervisor"], capture=True)
    run(["git", "branch", "-M", DEFAULTS["base_branch"]], capture=True)
    run(["git", "push", "-u", "origin", DEFAULTS["base_branch"]], capture=True)
    audit("initial main branch pushed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    start_parser = subparsers.add_parser("start")
    start_parser.add_argument("--detach", action="store_true")

    subparsers.add_parser("stop")
    subparsers.add_parser("status")
    subparsers.add_parser("bootstrap-github")
    subparsers.add_parser("init-git")
    subparsers.add_parser("serve")

    state_server_parser = subparsers.add_parser("serve-state")
    state_server_parser.add_argument("--port", type=int, default=8787)

    return parser.parse_args()


def main() -> int:
    ensure_runtime_dirs()
    args = parse_args()
    if args.command == "start":
        return start(args.detach)
    if args.command == "stop":
        return stop()
    if args.command == "status":
        return status()
    if args.command == "bootstrap-github":
        bootstrap_github()
        return 0
    if args.command == "init-git":
        init_git()
        return 0
    if args.command == "serve":
        return serve()
    if args.command == "serve-state":
        from state_server import main as serve_state_main
        import sys
        sys.argv = ["state_server", "--port", str(args.port)]
        serve_state_main()
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

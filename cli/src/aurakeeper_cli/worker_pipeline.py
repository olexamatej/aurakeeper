from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

from .backend import BackendClient
from .state import RUNS_DIR


REPLICATOR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "status",
        "tldr",
        "likelyCause",
        "reproductionSteps",
        "commands",
        "relevantLogs",
        "affectedFiles",
        "missingContext",
        "confidence",
    ],
    "properties": {
        "status": {"type": "string", "enum": ["reproduced", "not_reproduced", "needs_context"]},
        "tldr": {"type": "string"},
        "likelyCause": {"type": "string"},
        "reproductionSteps": {"type": "array", "items": {"type": "string"}},
        "commands": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["command", "exitCode", "summary"],
                "properties": {
                    "command": {"type": "string"},
                    "exitCode": {"type": "integer"},
                    "summary": {"type": "string"},
                },
            },
        },
        "relevantLogs": {"type": "array", "items": {"type": "string"}},
        "affectedFiles": {"type": "array", "items": {"type": "string"}},
        "missingContext": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
}

WORKER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "status",
        "issueSummary",
        "suspectedRootCause",
        "filesChanged",
        "verificationCommands",
        "verificationSummary",
        "patchSummary",
        "confidence",
        "remainingRisk",
    ],
    "properties": {
        "status": {"type": "string", "enum": ["patched", "blocked", "needs_context"]},
        "issueSummary": {"type": "string"},
        "suspectedRootCause": {"type": "string"},
        "filesChanged": {"type": "array", "items": {"type": "string"}},
        "verificationCommands": {"type": "array", "items": {"type": "string"}},
        "verificationSummary": {"type": "string"},
        "patchSummary": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "remainingRisk": {"type": "array", "items": {"type": "string"}},
    },
}


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[3]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def run_codex(
    *,
    repo_path: Path,
    prompt: str,
    schema: dict[str, Any],
    sandbox: str,
    output_path: Path,
    run_dir: Path,
) -> tuple[dict[str, Any], str]:
    schema_path = run_dir / f"{output_path.stem}.schema.json"
    schema_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    command = [
        "codex",
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        sandbox,
        "--cd",
        str(repo_path),
        "--add-dir",
        str(run_dir),
        "--output-schema",
        str(schema_path),
        "--output-last-message",
        str(output_path),
        prompt,
    ]
    completed = subprocess.run(
        command,
        cwd=repo_path,
        text=True,
        capture_output=True,
        timeout=20 * 60,
        check=False,
    )
    combined_output = (completed.stdout or "") + (completed.stderr or "")
    if completed.returncode != 0:
        raise RuntimeError(f"codex exited with {completed.returncode}: {combined_output.strip()}")
    return json.loads(read_text(output_path)), combined_output


def git_status_snapshot(repo_path: Path) -> dict[str, str]:
    completed = subprocess.run(
        ["git", "status", "--short", "--untracked-files=all"],
        cwd=repo_path,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return {}

    snapshot: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if len(line) < 4:
            continue
        snapshot[line[3:]] = line[:2].strip()
    return snapshot


def diff_changed_files(before: dict[str, str], after: dict[str, str]) -> list[str]:
    paths = sorted(set(before) | set(after))
    changed = [path for path in paths if before.get(path) != after.get(path)]
    return changed


def run_verification(repo_path: Path, command: str | None) -> dict[str, Any]:
    if not command:
        return {
            "command": None,
            "exitCode": None,
            "stdout": "",
            "stderr": "",
        }

    completed = subprocess.run(
        command,
        cwd=repo_path,
        shell=True,
        text=True,
        capture_output=True,
        check=False,
        timeout=15 * 60,
    )
    return {
        "command": command,
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def build_replicator_prompt(job: dict[str, Any], run_dir: Path) -> str:
    instructions = read_text(workspace_root() / "agents" / "replicator.md")
    return "\n".join(
        [
            instructions,
            "",
            "Write the response as strict JSON matching the provided schema.",
            "Inspect the repository, run only the smallest useful commands, and do not modify source files.",
            f"Write any notes or artifacts under {run_dir}.",
            "",
            "Repair job context:",
            json.dumps(job, indent=2),
        ]
    )


def build_worker_prompt(job: dict[str, Any], replicator_result: dict[str, Any], run_dir: Path) -> str:
    instructions = read_text(workspace_root() / "agents" / "worker.md")
    return "\n".join(
        [
            instructions,
            "",
            "Write the response as strict JSON matching the provided schema.",
            "Modify only the smallest set of files needed under the allowedRepairPaths from projectConfig.",
            "Do not use destructive git commands and do not edit unrelated files.",
            f"Use {run_dir} for any generated artifacts outside the repository.",
            "",
            "Repair job context:",
            json.dumps(job, indent=2),
            "",
            "Replicator handoff:",
            json.dumps(replicator_result, indent=2),
        ]
    )


def process_repair_job(client: BackendClient, job_payload: dict[str, Any]) -> None:
    job = job_payload["job"]
    attempt = job_payload["attempt"]
    project_config = job_payload["projectConfig"]
    repo_path = Path(project_config["repoPath"]).resolve()
    run_dir = RUNS_DIR / str(job["projectId"]) / str(attempt["id"])
    run_dir.mkdir(parents=True, exist_ok=True)

    write_json(run_dir / "job.json", job_payload)

    before = git_status_snapshot(repo_path)
    failure_reason: str | None = None

    try:
        replicator_result, replicator_output = run_codex(
            repo_path=repo_path,
            prompt=build_replicator_prompt(job_payload, run_dir),
            schema=REPLICATOR_SCHEMA,
            sandbox="read-only",
            output_path=run_dir / "replicator-result.json",
            run_dir=run_dir,
        )
    except Exception as error:
        replicator_result = {
            "status": "needs_context",
            "tldr": "Replicator did not complete.",
            "likelyCause": str(error),
            "reproductionSteps": [],
            "commands": [],
            "relevantLogs": [],
            "affectedFiles": [],
            "missingContext": [str(error)],
            "confidence": 0,
        }
        replicator_output = str(error)
        failure_reason = str(error)

    write_json(run_dir / "replicator-output.json", replicator_result)
    write_text(run_dir / "replicator.log", replicator_output)

    verification = {"command": None, "exitCode": None, "stdout": "", "stderr": ""}

    try:
        worker_result, worker_output = run_codex(
            repo_path=repo_path,
            prompt=build_worker_prompt(job_payload, replicator_result, run_dir),
            schema=WORKER_SCHEMA,
            sandbox="workspace-write",
            output_path=run_dir / "worker-result.json",
            run_dir=run_dir,
        )
    except Exception as error:
        worker_result = {
            "status": "needs_context",
            "issueSummary": "Worker did not complete.",
            "suspectedRootCause": str(error),
            "filesChanged": [],
            "verificationCommands": [],
            "verificationSummary": "Worker execution failed before verification.",
            "patchSummary": "No patch was produced.",
            "confidence": 0,
            "remainingRisk": [str(error)],
        }
        worker_output = str(error)
        failure_reason = failure_reason or str(error)

    write_json(run_dir / "worker-output.json", worker_result)
    write_text(run_dir / "worker.log", worker_output)

    verification = run_verification(repo_path, project_config.get("testCommand"))
    write_json(run_dir / "verification.json", verification)

    after = git_status_snapshot(repo_path)
    changed_files = diff_changed_files(before, after)

    status = "patched"
    if worker_result["status"] != "patched":
        status = "needs_manual_review"
    elif verification["exitCode"] not in (None, 0):
        status = "failed"
        failure_reason = failure_reason or "Verification command failed"

    client.complete_repair_job(
        str(job["id"]),
        {
            "attemptId": attempt["id"],
            "status": status,
            "replicatorHandoffPath": str(run_dir / "replicator-output.json"),
            "patchSummary": worker_result["patchSummary"],
            "verificationCommand": verification["command"],
            "verificationExitCode": verification["exitCode"],
            "verificationStdout": verification["stdout"],
            "verificationStderr": verification["stderr"],
            "confidence": worker_result["confidence"],
            "runDirectory": str(run_dir),
            "failureReason": failure_reason,
            "resultPayload": {
                "changedFiles": changed_files,
                "replicator": replicator_result,
                "worker": worker_result,
            },
        },
    )


def run_worker_loop(
    *,
    base_url: str,
    admin_token: str,
    worker_id: str,
    poll_interval_seconds: float = 3.0,
) -> None:
    client = BackendClient(base_url=base_url, admin_token=admin_token)

    while True:
        response = client.claim_repair_job(worker_id)
        if response.get("job") is None:
            time.sleep(poll_interval_seconds)
            continue

        try:
            process_repair_job(client, response)
        except Exception as error:
            job = response["job"]
            attempt = response["attempt"]
            run_dir = RUNS_DIR / str(job["projectId"]) / str(attempt["id"])
            run_dir.mkdir(parents=True, exist_ok=True)
            write_text(run_dir / "worker-failure.log", f"{error}\n")
            client.complete_repair_job(
                str(job["id"]),
                {
                    "attemptId": attempt["id"],
                    "status": "failed",
                    "replicatorHandoffPath": str(run_dir / "replicator-output.json"),
                    "patchSummary": "Local worker pipeline failed before completion.",
                    "verificationCommand": None,
                    "verificationExitCode": None,
                    "verificationStdout": "",
                    "verificationStderr": "",
                    "confidence": 0,
                    "runDirectory": str(run_dir),
                    "failureReason": str(error),
                    "resultPayload": {"error": str(error)},
                },
            )

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


STATE_ROOT = Path.home() / ".aurakeeper"
STATE_DIR = STATE_ROOT / "state"
LOG_DIR = STATE_ROOT / "logs"
RUNS_DIR = STATE_ROOT / "runs"
PROCESS_FILE = STATE_DIR / "processes.json"


@dataclass(slots=True)
class BackendProcessRecord:
    pid: int
    port: int
    admin_token: str
    log_path: str
    started_at: str


@dataclass(slots=True)
class WorkerProcessRecord:
    pid: int
    port: int
    admin_token: str
    worker_id: str
    log_path: str
    started_at: str


def ensure_state_dirs() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def load_process_state() -> dict[str, object]:
    ensure_state_dirs()
    if not PROCESS_FILE.exists():
        return {}

    return json.loads(PROCESS_FILE.read_text(encoding="utf-8"))


def save_process_state(state: dict[str, object]) -> None:
    ensure_state_dirs()
    PROCESS_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def get_backend_process() -> BackendProcessRecord | None:
    raw_state = load_process_state()
    backend = raw_state.get("backend")
    if not isinstance(backend, dict):
        return None

    try:
        return BackendProcessRecord(
            pid=int(backend["pid"]),
            port=int(backend["port"]),
            admin_token=str(backend["admin_token"]),
            log_path=str(backend["log_path"]),
            started_at=str(backend["started_at"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def save_backend_process(record: BackendProcessRecord) -> None:
    raw_state = load_process_state()
    raw_state["backend"] = {
        "pid": record.pid,
        "port": record.port,
        "admin_token": record.admin_token,
        "log_path": record.log_path,
        "started_at": record.started_at,
    }
    save_process_state(raw_state)


def get_worker_process() -> WorkerProcessRecord | None:
    raw_state = load_process_state()
    worker = raw_state.get("worker")
    if not isinstance(worker, dict):
        return None

    try:
        return WorkerProcessRecord(
            pid=int(worker["pid"]),
            port=int(worker["port"]),
            admin_token=str(worker["admin_token"]),
            worker_id=str(worker["worker_id"]),
            log_path=str(worker["log_path"]),
            started_at=str(worker["started_at"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def save_worker_process(record: WorkerProcessRecord) -> None:
    raw_state = load_process_state()
    raw_state["worker"] = {
        "pid": record.pid,
        "port": record.port,
        "admin_token": record.admin_token,
        "worker_id": record.worker_id,
        "log_path": record.log_path,
        "started_at": record.started_at,
    }
    save_process_state(raw_state)

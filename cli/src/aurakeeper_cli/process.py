from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from .state import (
    BackendProcessRecord,
    LOG_DIR,
    WorkerProcessRecord,
    ensure_state_dirs,
    get_backend_process,
    get_worker_process,
    save_worker_process,
    save_backend_process,
    utc_now,
)


def is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def backend_root() -> Path:
    return Path(__file__).resolve().parents[3] / "backend"


def cli_root() -> Path:
    return Path(__file__).resolve().parents[3] / "cli"


def backend_base_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def backend_healthcheck(port: int, timeout: float = 1.0) -> bool:
    try:
        with urlopen(f"{backend_base_url(port)}/", timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status == 200 and body == "OK"
    except URLError:
        return False


def ensure_backend_running(port: int, admin_token: str) -> BackendProcessRecord:
    existing = get_backend_process()
    if existing and is_process_alive(existing.pid) and backend_healthcheck(existing.port):
        return existing

    ensure_state_dirs()
    log_path = LOG_DIR / "backend.log"
    backend_dir = backend_root()
    log_file = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        ["bun", "run", "start"],
        cwd=backend_dir,
        env={
            **os.environ,
            "PORT": str(port),
            "ADMIN_TOKEN": admin_token,
        },
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        text=True,
    )
    record = BackendProcessRecord(
        pid=process.pid,
        port=port,
        admin_token=admin_token,
        log_path=str(log_path),
        started_at=utc_now(),
    )
    save_backend_process(record)

    deadline = time.time() + 15
    while time.time() < deadline:
        if backend_healthcheck(port):
            return record
        if process.poll() is not None:
            raise RuntimeError(f"Backend exited early with code {process.returncode}")
        time.sleep(0.25)

    raise RuntimeError("Timed out waiting for the AuraKeeper backend to start")


def stop_backend() -> None:
    existing = get_backend_process()
    if not existing:
        return
    if is_process_alive(existing.pid):
        os.kill(existing.pid, signal.SIGTERM)


def ensure_worker_running(port: int, admin_token: str) -> WorkerProcessRecord:
    existing = get_worker_process()
    if existing and is_process_alive(existing.pid):
        return existing

    ensure_state_dirs()
    log_path = LOG_DIR / "worker.log"
    cli_dir = cli_root()
    log_file = log_path.open("a", encoding="utf-8")
    worker_id = f"worker-{os.getpid()}-{int(time.time())}"
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "aurakeeper_cli.main",
            "worker-run",
            "--port",
            str(port),
            "--admin-token",
            admin_token,
            "--worker-id",
            worker_id,
        ],
        cwd=cli_dir,
        env={
            **os.environ,
            "PYTHONPATH": str(cli_dir / "src")
            if "PYTHONPATH" not in os.environ
            else f"{cli_dir / 'src'}{os.pathsep}{os.environ['PYTHONPATH']}",
        },
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        text=True,
    )
    record = WorkerProcessRecord(
        pid=process.pid,
        port=port,
        admin_token=admin_token,
        worker_id=worker_id,
        log_path=str(log_path),
        started_at=utc_now(),
    )
    save_worker_process(record)
    return record

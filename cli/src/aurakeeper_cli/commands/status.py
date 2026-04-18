from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..backend import BackendClient, BackendClientError
from ..process import backend_healthcheck, is_process_alive
from ..state import get_backend_process, get_worker_process


def status(args: Any) -> int:
    backend = get_backend_process()
    worker = get_worker_process()
    if backend is None:
        print(json.dumps({"backend": None, "worker": None}, indent=2))
        return 0

    payload: dict[str, Any] = {
        "backend": {
            "pid": backend.pid,
            "port": backend.port,
            "alive": backend_healthcheck(backend.port),
            "logPath": backend.log_path,
            "startedAt": backend.started_at,
        },
        "worker": None,
    }
    if worker is not None:
        payload["worker"] = {
            "pid": worker.pid,
            "port": worker.port,
            "workerId": worker.worker_id,
            "alive": is_process_alive(worker.pid),
            "logPath": worker.log_path,
            "startedAt": worker.started_at,
        }

    repo_path = Path(args.repo).resolve()
    config_path = repo_path / ".aurakeeper" / "config.json"
    if config_path.exists() and payload["backend"]["alive"]:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        project_id = config.get("projectId")
        if isinstance(project_id, str):
            client = BackendClient(
                base_url=f"http://127.0.0.1:{backend.port}",
                admin_token=backend.admin_token,
            )
            try:
                payload["project"] = client.project_status(project_id)
            except BackendClientError as error:
                payload["project"] = {"error": str(error)}

    print(
        json.dumps(payload, indent=2)
    )
    return 0

from __future__ import annotations

from typing import Any

from ..process import backend_base_url, ensure_backend_running, ensure_worker_running


def start(args: Any) -> int:
    record = ensure_backend_running(port=args.port, admin_token=args.admin_token)
    if args.no_worker:
        print(f"AuraKeeper backend listening at {backend_base_url(record.port)}")
        return 0

    worker = ensure_worker_running(port=record.port, admin_token=record.admin_token)
    print(
        f"AuraKeeper backend listening at {backend_base_url(record.port)} "
        f"with local worker {worker.worker_id}"
    )
    return 0

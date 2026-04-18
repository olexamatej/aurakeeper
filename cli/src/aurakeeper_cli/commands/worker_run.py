from __future__ import annotations

from typing import Any

from ..process import backend_base_url
from ..worker_pipeline import run_worker_loop


def worker_run(args: Any) -> int:
    run_worker_loop(
        base_url=backend_base_url(args.port),
        admin_token=args.admin_token,
        worker_id=args.worker_id,
    )
    return 0

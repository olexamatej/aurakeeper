from __future__ import annotations

import os
import threading

from app import build_invoice_summary
from aurakeeper import create_aurakeeper_connector


def main() -> None:
    endpoint = os.getenv(
        "AURAKEEPER_ENDPOINT", "http://127.0.0.1:3000/v1/logs/errors"
    )
    api_token = os.getenv("AURAKEEPER_API_TOKEN")

    if not endpoint or not api_token:
        raise SystemExit(
            "Set AURAKEEPER_API_TOKEN before running this example."
        )

    connector = create_aurakeeper_connector(
        endpoint=endpoint,
        api_token=api_token,
        service_name="generic-python-service",
        service_version="1.0.0",
        environment=os.getenv("PYTHON_ENV", "development"),
        framework="python",
        component="invoice-worker",
        tags=["backend", "python-example"],
        context={
            "session": {
                "source": "examples/standalone",
            }
        },
    )

    connector.install()

    def crash_worker() -> None:
        build_invoice_summary({"id": "INV-100", "total": 42.0})

    worker = threading.Thread(target=crash_worker, name="aurakeeper-example")
    worker.start()
    worker.join()

    connector.flush()
    print("Connector flush completed.")
    connector.close(wait_for_pending=False)


if __name__ == "__main__":
    main()

from __future__ import annotations

import os
from pprint import pprint

from aurakeeper import create_aurakeeper_connector


def main() -> None:
    endpoint = os.getenv("AURAKEEPER_ENDPOINT")
    api_token = os.getenv("AURAKEEPER_API_TOKEN")

    if not endpoint or not api_token:
        raise SystemExit(
            "Set AURAKEEPER_ENDPOINT and AURAKEEPER_API_TOKEN before running this example."
        )

    connector = create_aurakeeper_connector(
        endpoint=endpoint,
        api_token=api_token,
        service_name="generic-python-service",
        service_version="1.0.0",
        environment=os.getenv("PYTHON_ENV", "development"),
        framework="python",
        component="example-worker",
        tags=["backend", "python-example"],
        context={
            "session": {
                "source": "examples/standalone",
            }
        },
    )

    connector.install()

    try:
        raise ValueError("Handled Python example error")
    except ValueError as error:
        handled_future = connector.capture_exception(
            error,
            handled=True,
            level="error",
            correlation_id="job_reconcile_payments_123",
            request={
                "method": "JOB",
                "path": "reconcile-payments",
            },
            user={
                "id": "system",
            },
            details={
                "jobName": "reconcile-payments",
                "attempt": 1,
            },
        )
        pprint(handled_future.result())

    message_future = connector.capture_message(
        "Manual message capture from the standalone example",
        level="warning",
        handled=True,
        details={"category": "example"},
    )
    pprint(message_future.result())

    connector.flush()
    print("Connector flush completed.")
    connector.close(wait_for_pending=False)


if __name__ == "__main__":
    main()

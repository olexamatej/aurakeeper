from __future__ import annotations

import json
import os
from pprint import pprint

from aurakeeper import create_aurakeeper_connector

EXAMPLE_ENDPOINT = "https://api.example.com/v1/logs/errors"
EXAMPLE_API_TOKEN = "replace-with-real-api-token"


def build_transport(use_mock_transport: bool):
    if not use_mock_transport:
        return None

    def mock_transport(config):
        print("AuraKeeper standalone example payload")
        print(json.dumps(config["payload"], indent=2, sort_keys=True))
        return {"status": 202, "mocked": True}

    return mock_transport


def main() -> None:
    endpoint = os.getenv("AURAKEEPER_ENDPOINT", EXAMPLE_ENDPOINT)
    api_token = os.getenv("AURAKEEPER_API_TOKEN", EXAMPLE_API_TOKEN)
    use_mock_transport = endpoint == EXAMPLE_ENDPOINT or api_token == EXAMPLE_API_TOKEN

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
        transport=build_transport(use_mock_transport),
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
    print(
        "Connector flush completed using {} transport.".format(
            "mock" if use_mock_transport else "live"
        )
    )
    connector.close(wait_for_pending=False)


if __name__ == "__main__":
    main()

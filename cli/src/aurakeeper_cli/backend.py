from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class BackendClientError(RuntimeError):
    pass


@dataclass(slots=True)
class BackendClient:
    base_url: str
    admin_token: str

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={
                "Content-Type": "application/json",
                "X-Admin-Token": self.admin_token,
            },
        )

        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            details = error.read().decode("utf-8", errors="replace")
            raise BackendClientError(f"{method} {path} failed with {error.code}: {details}") from error
        except URLError as error:
            raise BackendClientError(f"{method} {path} failed: {error}") from error

    def create_project(self, name: str) -> dict[str, Any]:
        return self._request("POST", "/v1/projects", {"name": name})

    def select_collector(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/v1/local/collector-selection", payload)

    def upsert_project_config(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("PUT", f"/v1/local/projects/{project_id}/config", payload)

    def project_status(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/local/projects/{project_id}/status")

    def error_groups(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/local/error-groups?projectId={project_id}")

    def repair_attempts(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/local/repair-attempts?projectId={project_id}")

    def claim_repair_job(self, worker_id: str) -> dict[str, Any]:
        return self._request("POST", "/v1/local/repair-jobs/claim", {"workerId": worker_id})

    def complete_repair_job(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/v1/local/repair-jobs/{job_id}/complete", payload)

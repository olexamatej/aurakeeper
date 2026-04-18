from __future__ import annotations

import json
import platform
import socket
import sys
import threading
import traceback
import urllib.error
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Callable, Iterable
from uuid import uuid4

MAX_SANITIZE_DEPTH = 6


@dataclass(frozen=True)
class _HookState:
    sys_excepthook: Callable[..., Any] | None = None
    threading_excepthook: Callable[..., Any] | None = None


class AuraKeeperConnector:
    def __init__(
        self,
        *,
        endpoint: str,
        api_token: str,
        service_name: str,
        service_version: str | None = None,
        environment: str | None = None,
        platform_name: str | None = None,
        framework: str | None = None,
        component: str | None = None,
        instance_id: str | None = None,
        tags: Iterable[str] | None = None,
        context: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 5.0,
        transport: Callable[[dict[str, Any]], Any] | None = None,
        before_send: Callable[[dict[str, Any]], dict[str, Any] | bool | None] | None = None,
        on_transport_error: Callable[[BaseException], None] | None = None,
        capture_uncaught: bool = True,
        capture_threads: bool = True,
        max_workers: int = 2,
    ) -> None:
        if not endpoint:
            raise ValueError("AuraKeeperConnector requires an endpoint.")

        if not api_token:
            raise ValueError("AuraKeeperConnector requires an api_token.")

        if not service_name:
            raise ValueError("AuraKeeperConnector requires a service_name.")

        self.endpoint = endpoint
        self.api_token = api_token
        self.service_name = service_name
        self.service_version = service_version
        self.environment = environment
        self.platform_name = platform_name
        self.framework = framework
        self.component = component
        self.instance_id = instance_id
        self.tags = list(tags or [])
        self.context = dict(context or {})
        self.headers = dict(headers or {})
        self.timeout = timeout
        self.transport = transport or _default_transport
        self.before_send = before_send
        self.on_transport_error = on_transport_error
        self.capture_uncaught = capture_uncaught
        self.capture_threads = capture_threads
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="aurakeeper",
        )
        self.pending_requests: set[Future[Any]] = set()
        self.installed = False
        self._hook_state = _HookState()
        self._lock = threading.Lock()

    def install(self) -> "AuraKeeperConnector":
        if self.installed:
            return self

        if self.capture_uncaught:
            self._hook_state = _HookState(
                sys_excepthook=sys.excepthook,
                threading_excepthook=self._hook_state.threading_excepthook,
            )
            sys.excepthook = self._handle_uncaught_exception

        if self.capture_threads and hasattr(threading, "excepthook"):
            self._hook_state = _HookState(
                sys_excepthook=self._hook_state.sys_excepthook,
                threading_excepthook=threading.excepthook,
            )
            threading.excepthook = self._handle_thread_exception

        self.installed = True
        return self

    def uninstall(self) -> "AuraKeeperConnector":
        if not self.installed:
            return self

        if self.capture_uncaught and self._hook_state.sys_excepthook is not None:
            sys.excepthook = self._hook_state.sys_excepthook

        if (
            self.capture_threads
            and hasattr(threading, "excepthook")
            and self._hook_state.threading_excepthook is not None
        ):
            threading.excepthook = self._hook_state.threading_excepthook

        self.installed = False
        self._hook_state = _HookState()
        return self

    def close(self, *, wait_for_pending: bool = True, timeout: float | None = None) -> None:
        if wait_for_pending:
            self.flush(timeout=timeout)

        self.uninstall()
        self.executor.shutdown(wait=wait_for_pending)

    def capture_exception(
        self,
        error: BaseException | Any,
        overrides: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Future[Any]:
        payload = self.build_payload(error, overrides=overrides, **kwargs)

        if payload is None:
            return _completed_future(None)

        future = self.executor.submit(self.send, payload)
        self._track_future(future)
        return future

    def capture_message(
        self,
        message: str,
        overrides: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Future[Any]:
        return self.capture_exception(RuntimeError(str(message)), overrides=overrides, **kwargs)

    def build_payload(
        self,
        error: BaseException | Any,
        overrides: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any] | None:
        override_values = _merge_dicts(overrides, kwargs)
        normalized = _normalize_unknown_error(error, "Unknown error")
        merged_details = _sanitize_json(
            _merge_dicts(
                normalized["details"],
                _get_alias(override_values, "details"),
            )
        )
        merged_context = _sanitize_json(self.build_context(override_values))

        payload = {
            "eventId": _coalesce(
                _get_alias(override_values, "event_id", "eventId"),
                str(uuid4()),
            ),
            "occurredAt": _coalesce(
                _get_alias(override_values, "occurred_at", "occurredAt"),
                _utc_now_isoformat(),
            ),
            "level": _coalesce(_get_alias(override_values, "level"), "error"),
            "platform": _coalesce(
                _get_alias(override_values, "platform"),
                self.platform_name,
                _detect_platform(),
            ),
            "environment": _coalesce(
                _get_alias(override_values, "environment"),
                self.environment,
            ),
            "service": _compact_object(
                _merge_dicts(
                    {
                        "name": self.service_name,
                        "version": self.service_version,
                        "instanceId": self.instance_id,
                    },
                    _get_alias(override_values, "service"),
                )
            ),
            "source": _compact_object(
                _merge_dicts(
                    {
                        "runtime": _detect_runtime(),
                        "language": "python",
                        "framework": self.framework,
                        "component": self.component,
                    },
                    _get_alias(override_values, "source"),
                )
            ),
            "error": _compact_object(
                {
                    "type": _coalesce(
                        _get_alias(override_values, "type"),
                        normalized["error_type"],
                        "Exception",
                    ),
                    "message": _coalesce(
                        _get_alias(override_values, "message"),
                        normalized["message"],
                        "Unknown error",
                    ),
                    "code": _coalesce(
                        _get_alias(override_values, "code"),
                        _read_error_code(error),
                    ),
                    "stack": _coalesce(
                        _get_alias(override_values, "stack"),
                        normalized["stack"],
                    ),
                    "handled": _coalesce(
                        _get_alias(override_values, "handled"),
                        True,
                    ),
                    "details": merged_details if _has_own_keys(merged_details) else None,
                }
            ),
            "context": merged_context if _has_own_keys(merged_context) else None,
        }

        if self.before_send is not None:
            next_payload = self.before_send(payload)
            if next_payload is False or next_payload is None:
                return None
            payload = next_payload

        return _prune_empty(_compact_object(payload))

    def build_context(self, overrides: dict[str, Any] | None = None) -> dict[str, Any] | None:
        override_values = overrides or {}
        option_context = self.context
        override_context = _get_alias(override_values, "context") or {}
        tags = _unique_strings(
            [
                *self.tags,
                *(_get_alias(option_context, "tags") or []),
                *(_get_alias(override_context, "tags") or []),
                *(_get_alias(override_values, "tags") or []),
            ]
        )

        merged_context = _merge_dicts(
            option_context,
            override_context,
            {
                "request": _merge_dicts(
                    _get_alias(option_context, "request"),
                    _get_alias(override_context, "request"),
                    _get_alias(override_values, "request"),
                ),
                "user": _merge_dicts(
                    _get_alias(option_context, "user"),
                    _get_alias(override_context, "user"),
                    _get_alias(override_values, "user"),
                ),
                "session": _merge_dicts(
                    _get_alias(option_context, "session"),
                    _get_alias(override_context, "session"),
                    _get_alias(override_values, "session"),
                ),
                "device": _merge_dicts(
                    _get_alias(option_context, "device"),
                    _get_alias(override_context, "device"),
                    _get_alias(override_values, "device"),
                ),
                "correlationId": _coalesce(
                    _get_alias(override_values, "correlation_id", "correlationId"),
                    _get_alias(override_context, "correlation_id", "correlationId"),
                    _get_alias(option_context, "correlation_id", "correlationId"),
                ),
                "tags": tags or None,
            },
        )

        return _prune_empty(merged_context)

    def send(self, payload: dict[str, Any]) -> Any:
        return self.transport(
            {
                "endpoint": self.endpoint,
                "api_token": self.api_token,
                "apiToken": self.api_token,
                "payload": payload,
                "headers": dict(self.headers),
                "timeout": self.timeout,
            }
        )

    def flush(
        self,
        *,
        timeout: float | None = None,
    ) -> list[dict[str, Any]]:
        with self._lock:
            pending = list(self.pending_requests)

        if not pending:
            return []

        done, not_done = wait(pending, timeout=timeout)
        results: list[dict[str, Any]] = []

        for future in done:
            try:
                results.append({"status": "fulfilled", "value": future.result()})
            except BaseException as error:
                results.append({"status": "rejected", "reason": error})

        for future in not_done:
            results.append({"status": "pending", "future": future})

        return results

    def _track_future(self, future: Future[Any]) -> None:
        with self._lock:
            self.pending_requests.add(future)

        future.add_done_callback(self._remove_future)

    def _remove_future(self, future: Future[Any]) -> None:
        with self._lock:
            self.pending_requests.discard(future)

    def _handle_uncaught_exception(
        self,
        exc_type: type[BaseException],
        exc_value: BaseException,
        exc_traceback: TracebackType | None,
    ) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            if self._hook_state.sys_excepthook is not None:
                self._hook_state.sys_excepthook(exc_type, exc_value, exc_traceback)
            return

        self._send_automatic_exception(
            exc_value,
            handled=False,
            level="critical",
            platform=self.platform_name or "backend",
            source={"runtime": _detect_runtime()},
        )

        if self._hook_state.sys_excepthook is not None:
            self._hook_state.sys_excepthook(exc_type, exc_value, exc_traceback)

    def _handle_thread_exception(self, args: threading.ExceptHookArgs) -> None:
        self._send_automatic_exception(
            args.exc_value,
            handled=False,
            level="critical",
            platform=self.platform_name or "backend",
            source={"runtime": _detect_runtime()},
            details={
                "thread": _sanitize_json_value(
                    {
                        "name": getattr(args.thread, "name", None),
                        "ident": getattr(args.thread, "ident", None),
                    }
                )
            },
        )

        if self._hook_state.threading_excepthook is not None:
            self._hook_state.threading_excepthook(args)

    def _send_automatic_exception(
        self,
        error: BaseException | Any,
        **kwargs: Any,
    ) -> None:
        payload = self.build_payload(error, **kwargs)
        if payload is None:
            return

        try:
            self.send(payload)
        except BaseException as transport_error:
            if self.on_transport_error is not None:
                self.on_transport_error(transport_error)
                return

            print("AuraKeeper failed to send error log.", transport_error, file=sys.stderr)


def create_aurakeeper_connector(**kwargs: Any) -> AuraKeeperConnector:
    return AuraKeeperConnector(**kwargs)


def _default_transport(config: dict[str, Any]) -> Any:
    headers = _merge_dicts(
        {
            "content-type": "application/json",
            "X-API-Token": config["api_token"],
        },
        config.get("headers"),
    )
    request = urllib.request.Request(
        config["endpoint"],
        data=json.dumps(config["payload"]).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=config.get("timeout", 5.0)) as response:
            raw_body = response.read().decode("utf-8")
            if not raw_body:
                return {"status": response.status}

            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type:
                return json.loads(raw_body)

            return {"status": response.status, "body": raw_body}
    except urllib.error.HTTPError as error:
        raw_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"AuraKeeper request failed with status {error.code}: {raw_body}"
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"AuraKeeper request failed: {error.reason}") from error


def _normalize_unknown_error(value: Any, fallback_message: str) -> dict[str, Any]:
    if isinstance(value, BaseException):
        return {
            "error_type": value.__class__.__name__,
            "message": str(value) or fallback_message,
            "stack": "".join(
                traceback.format_exception(type(value), value, value.__traceback__)
            ).strip()
            or None,
            "details": None,
        }

    if isinstance(value, dict) and isinstance(value.get("message"), str):
        return {
            "error_type": value.get("name") or "Error",
            "message": value["message"],
            "stack": value.get("stack"),
            "details": _sanitize_json(value),
        }

    if isinstance(value, str) and value:
        return {
            "error_type": "Error",
            "message": value,
            "stack": None,
            "details": None,
        }

    return {
        "error_type": "Error",
        "message": fallback_message,
        "stack": None,
        "details": None
        if value is None
        else {
            "originalValue": _sanitize_json(value),
        },
    }


def _read_error_code(error: Any) -> str | None:
    code = getattr(error, "code", None)
    if isinstance(code, str) and code:
        return code
    return None


def _detect_platform() -> str:
    return "backend"


def _detect_runtime() -> str:
    implementation = platform.python_implementation().lower()
    if implementation == "cpython":
        return "cpython"
    if implementation == "pypy":
        return "pypy"
    return implementation or "python"


def _utc_now_isoformat() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _completed_future(value: Any) -> Future[Any]:
    future: Future[Any] = Future()
    future.set_result(value)
    return future


def _coalesce(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _get_alias(source: dict[str, Any] | None, *keys: str) -> Any:
    if not isinstance(source, dict):
        return None

    for key in keys:
        if key in source:
            return source[key]

    return None


def _merge_dicts(*values: Any) -> dict[str, Any]:
    merged: dict[str, Any] = {}

    for value in values:
        if not isinstance(value, dict):
            continue

        for key, current in value.items():
            if current is not None:
                merged[key] = current

    return merged


def _unique_strings(values: Iterable[Any]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()

    for value in values:
        if not isinstance(value, str) or not value:
            continue

        if value in seen:
            continue

        seen.add(value)
        output.append(value)

    return output


def _compact_object(value: Any) -> Any:
    if not isinstance(value, dict):
        return value

    return {key: item for key, item in value.items() if item is not None}


def _prune_empty(value: Any) -> Any:
    if isinstance(value, list):
        next_array = [item for item in (_prune_empty(entry) for entry in value) if item is not None]
        return next_array or None

    if not isinstance(value, dict):
        return value

    next_object: dict[str, Any] = {}
    for key, item in value.items():
        next_value = _prune_empty(item)
        if next_value is not None:
            next_object[key] = next_value

    return next_object or None


def _has_own_keys(value: Any) -> bool:
    return isinstance(value, dict) and bool(value)


def _sanitize_json(value: Any) -> Any:
    return _sanitize_json_value(value, seen=set(), depth=0)


def _sanitize_json_value(value: Any, seen: set[int] | None = None, depth: int = 0) -> Any:
    if seen is None:
        seen = set()

    if value is None:
        return None

    if depth >= MAX_SANITIZE_DEPTH:
        return "[MaxDepth]"

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    if isinstance(value, BaseException):
        return _compact_object(
            {
                "name": value.__class__.__name__,
                "message": str(value),
                "stack": "".join(
                    traceback.format_exception(type(value), value, value.__traceback__)
                ).strip()
                or None,
                "code": _read_error_code(value),
            }
        )

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat()
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    if isinstance(value, (list, tuple, set, frozenset)):
        return [_sanitize_json_value(item, seen=seen, depth=depth + 1) for item in value]

    if isinstance(value, dict):
        object_id = id(value)
        if object_id in seen:
            return "[Circular]"

        seen.add(object_id)
        try:
            return {
                str(key): _sanitize_json_value(item, seen=seen, depth=depth + 1)
                for key, item in value.items()
            }
        finally:
            seen.remove(object_id)

    if callable(value):
        return "[Function]"

    if isinstance(value, socket.socket):
        return repr(value)

    return str(value)

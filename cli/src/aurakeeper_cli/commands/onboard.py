from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..backend import BackendClient
from ..patching import (
    ensure_directory,
    install_file_dependency,
    patch_entrypoint,
    render_collector_bootstrap,
    upsert_env_var,
    write_json,
)
from ..process import backend_base_url, ensure_backend_running, ensure_worker_running
from ..repository import RepoSignals, inspect_repository


COLLECTOR_INVENTORY = [
    {
        "id": "javascript-node-nextjs",
        "runtime": "node",
        "framework": "next",
        "description": "JavaScript collector for Next.js and hybrid Node.js apps.",
        "installStrategy": "dependency",
    },
    {
        "id": "javascript-node-generic",
        "runtime": "node",
        "description": "JavaScript collector for generic Node.js services.",
        "installStrategy": "dependency",
    },
]


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[4]


def build_selector_payload(signals: RepoSignals, auto_patch_allowed: bool) -> dict[str, Any]:
    return {
        "repoPath": str(signals.repo_path),
        "packageManager": signals.package_manager,
        "runtimeCandidates": signals.runtime_candidates,
        "frameworkCandidates": signals.framework_candidates,
        "topLevelFiles": signals.top_level_files,
        "lockfiles": signals.lockfiles,
        "likelyEntrypoints": signals.likely_entrypoints,
        "packageManifest": signals.package_manifest,
        "collectorInventory": COLLECTOR_INVENTORY,
        "autoPatchAllowed": auto_patch_allowed,
    }


def onboard(args: Any) -> int:
    repo_path = Path(args.repo).resolve()
    signals = inspect_repository(repo_path, service_name=args.service)
    backend_record = ensure_backend_running(port=args.port, admin_token=args.admin_token)
    worker_record = ensure_worker_running(port=backend_record.port, admin_token=backend_record.admin_token)
    client = BackendClient(
        base_url=backend_base_url(backend_record.port),
        admin_token=backend_record.admin_token,
    )

    project = client.create_project(signals.service_name)
    selection = client.select_collector(
        build_selector_payload(signals, auto_patch_allowed=not args.no_auto_patch)
    )

    aurakeeper_dir = repo_path / ".aurakeeper"
    ensure_directory(aurakeeper_dir)
    collector_file = aurakeeper_dir / "collector.js"
    collector_file.write_text(
        render_collector_bootstrap(
            service_name=signals.service_name,
            endpoint=f"{backend_base_url(backend_record.port)}/v1/logs/errors",
            token_env_var="AURAKEEPER_API_TOKEN",
        ),
        encoding="utf-8",
    )

    package_path = workspace_root() / "connectors" / "javascript"
    install_file_dependency(
        repo_path=repo_path,
        package_manager=signals.package_manager,
        package_name="@aurakeeper/javascript-connector",
        package_path=package_path,
    )

    env_path = repo_path / ".env.local"
    upsert_env_var(env_path, "AURAKEEPER_API_TOKEN", project["token"])
    upsert_env_var(
        env_path,
        "AURAKEEPER_ENDPOINT",
        f"{backend_base_url(backend_record.port)}/v1/logs/errors",
    )
    if signals.framework_candidates:
        upsert_env_var(env_path, "AURAKEEPER_FRAMEWORK", signals.framework_candidates[0])

    patched = False
    entrypoint = selection.get("entrypointPath")
    import_instruction = None
    if selection.get("patchMode") == "auto_patch" and isinstance(entrypoint, str):
        patched = patch_entrypoint(repo_path, entrypoint, collector_file)
    elif isinstance(entrypoint, str):
        import_instruction = f'Add `import "./.aurakeeper/collector";` to `{entrypoint}`.'

    config_payload = {
        "projectId": project["id"],
        "serviceName": signals.service_name,
        "runtime": selection["runtime"],
        "framework": selection.get("framework"),
        "packageManager": signals.package_manager,
        "endpoint": f"{backend_base_url(backend_record.port)}/v1/logs/errors",
        "statusEndpoint": backend_base_url(backend_record.port),
        "tokenEnvVar": "AURAKEEPER_API_TOKEN",
        "defaultEnvironment": "development",
        "installCommand": signals.install_command,
        "testCommand": signals.test_command,
        "allowedRepairPaths": signals.allowed_repair_paths,
        "selectorSource": selection["selectorSource"],
        "collectorId": selection["collectorId"],
        "patchMode": selection["patchMode"],
        "entrypointPath": entrypoint,
        "patchedEntrypoint": patched,
        "importInstruction": import_instruction,
        "warnings": selection["warnings"],
    }
    write_json(aurakeeper_dir / "config.json", config_payload)

    client.upsert_project_config(
        project["id"],
        {
            "serviceName": signals.service_name,
            "repoPath": str(repo_path),
            "runtime": selection["runtime"],
            "framework": selection.get("framework"),
            "packageManager": signals.package_manager,
            "installCommand": signals.install_command,
            "testCommand": signals.test_command,
            "entrypointPath": entrypoint,
            "endpoint": f"{backend_base_url(backend_record.port)}/v1/logs/errors",
            "tokenEnvVar": "AURAKEEPER_API_TOKEN",
            "allowedRepairPaths": signals.allowed_repair_paths,
        },
    )

    result = {
        "repo": str(repo_path),
        "projectId": project["id"],
        "serviceName": signals.service_name,
        "backendUrl": backend_base_url(backend_record.port),
        "workerId": worker_record.worker_id,
        "collector": selection,
        "patchedEntrypoint": patched,
        "entrypointPath": entrypoint,
        "importInstruction": import_instruction,
    }
    print(json.dumps(result, indent=2))
    return 0

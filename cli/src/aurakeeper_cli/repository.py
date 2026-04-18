from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ENTRYPOINT_CANDIDATES = [
    "app/layout.tsx",
    "app/layout.jsx",
    "pages/_app.tsx",
    "pages/_app.jsx",
    "src/index.ts",
    "src/index.js",
    "server.ts",
    "server.js",
    "index.ts",
    "index.js",
]


@dataclass(slots=True)
class RepoSignals:
    repo_path: Path
    service_name: str
    package_manager: str
    runtime_candidates: list[str]
    framework_candidates: list[str]
    top_level_files: list[str]
    lockfiles: list[str]
    likely_entrypoints: list[str]
    package_manifest: dict[str, Any]
    install_command: str
    test_command: str
    allowed_repair_paths: list[str]


def load_package_manifest(repo_path: Path) -> dict[str, Any]:
    package_json = repo_path / "package.json"
    if not package_json.exists():
        raise RuntimeError(f"{repo_path} does not look like a Node.js repository: package.json not found")

    return json.loads(package_json.read_text(encoding="utf-8"))


def detect_package_manager(repo_path: Path) -> tuple[str, list[str]]:
    lockfiles = []
    if (repo_path / "pnpm-lock.yaml").exists():
        lockfiles.append("pnpm-lock.yaml")
    if (repo_path / "yarn.lock").exists():
        lockfiles.append("yarn.lock")
    if (repo_path / "bun.lock").exists():
        lockfiles.append("bun.lock")
    if (repo_path / "bun.lockb").exists():
        lockfiles.append("bun.lockb")
    if (repo_path / "package-lock.json").exists():
        lockfiles.append("package-lock.json")

    if "pnpm-lock.yaml" in lockfiles:
        return "pnpm", lockfiles
    if "yarn.lock" in lockfiles:
        return "yarn", lockfiles
    if "bun.lock" in lockfiles or "bun.lockb" in lockfiles:
        return "bun", lockfiles
    return "npm", lockfiles


def detect_frameworks(package_manifest: dict[str, Any]) -> list[str]:
    dependencies = {}
    for key in ("dependencies", "devDependencies"):
        value = package_manifest.get(key)
        if isinstance(value, dict):
            dependencies.update(value)

    frameworks = []
    if "next" in dependencies:
        frameworks.append("next")
    if "express" in dependencies:
        frameworks.append("express")
    if "fastify" in dependencies:
        frameworks.append("fastify")
    if not frameworks:
        frameworks.append("node")
    return frameworks


def find_entrypoints(repo_path: Path) -> list[str]:
    results = [path for path in ENTRYPOINT_CANDIDATES if (repo_path / path).exists()]
    return results


def infer_test_command(package_manager: str, package_manifest: dict[str, Any]) -> str:
    scripts = package_manifest.get("scripts")
    if isinstance(scripts, dict) and isinstance(scripts.get("test"), str):
        return f"{package_manager} test"
    return f"{package_manager} run test"


def inspect_repository(repo_path: Path, service_name: str | None = None) -> RepoSignals:
    package_manifest = load_package_manifest(repo_path)
    package_manager, lockfiles = detect_package_manager(repo_path)
    frameworks = detect_frameworks(package_manifest)
    top_level_files = sorted(path.name for path in repo_path.iterdir())
    likely_entrypoints = find_entrypoints(repo_path)
    allowed_repair_paths = [
        path for path in ["src", "app", "pages", "server", "lib"] if (repo_path / path).exists()
    ]
    if not allowed_repair_paths:
        allowed_repair_paths = ["."]

    return RepoSignals(
        repo_path=repo_path,
        service_name=service_name or repo_path.name,
        package_manager=package_manager,
        runtime_candidates=["node"],
        framework_candidates=frameworks,
        top_level_files=top_level_files,
        lockfiles=lockfiles,
        likely_entrypoints=likely_entrypoints,
        package_manifest=package_manifest,
        install_command=f"{package_manager} install",
        test_command=infer_test_command(package_manager, package_manifest),
        allowed_repair_paths=allowed_repair_paths,
    )

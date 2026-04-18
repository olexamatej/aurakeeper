from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_directory(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def upsert_env_var(path: Path, key: str, value: str) -> None:
    lines = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()

    updated = False
    next_lines = []
    for line in lines:
        if line.startswith(f"{key}="):
            next_lines.append(f"{key}={value}")
            updated = True
        else:
            next_lines.append(line)

    if not updated:
        next_lines.append(f"{key}={value}")

    path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")


def install_file_dependency(repo_path: Path, package_manager: str, package_name: str, package_path: Path) -> None:
    package_json_path = repo_path / "package.json"
    package_json = json.loads(package_json_path.read_text(encoding="utf-8"))
    dependencies = package_json.setdefault("dependencies", {})
    if not isinstance(dependencies, dict):
        raise RuntimeError("package.json dependencies must be an object")

    dependencies[package_name] = f"file:{package_path}"
    package_json_path.write_text(json.dumps(package_json, indent=2) + "\n", encoding="utf-8")
    subprocess.run([package_manager, "install"], cwd=repo_path, check=True)


def render_collector_bootstrap(service_name: str, endpoint: str, token_env_var: str) -> str:
    return f"""const fs = require("node:fs");
const path = require("node:path");
const {{ createAuraKeeperConnector }} = require("@aurakeeper/javascript-connector");

function loadEnvFile(filePath) {{
  if (!fs.existsSync(filePath)) {{
    return;
  }}

  const lines = fs.readFileSync(filePath, "utf8").split(/\\r?\\n/);
  for (const line of lines) {{
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {{
      continue;
    }}

    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {{
      continue;
    }}

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {{
      process.env[key] = value;
    }}
  }}
}}

loadEnvFile(path.resolve(__dirname, "..", ".env.local"));

const connector = createAuraKeeperConnector({{
  endpoint: process.env.AURAKEEPER_ENDPOINT || "{endpoint}",
  apiToken: process.env.{token_env_var},
  serviceName: "{service_name}",
  environment: process.env.NODE_ENV || "development",
  framework: process.env.AURAKEEPER_FRAMEWORK,
}});

connector.install();

module.exports = connector;
"""


def relative_import(from_path: Path, target_path: Path) -> str:
    text = os.path.relpath(target_path, start=from_path.parent).replace("\\", "/")
    if not text.startswith("."):
        text = f"./{text}"
    return text


def patch_entrypoint(repo_path: Path, entrypoint: str, collector_file: Path) -> bool:
    entrypoint_path = repo_path / entrypoint
    if not entrypoint_path.exists():
        return False

    current = entrypoint_path.read_text(encoding="utf-8")
    relative = relative_import(entrypoint_path, collector_file)
    extension = entrypoint_path.suffix
    use_import = extension in {".ts", ".tsx", ".mts", ".mjs"}
    import_line = f'import "{relative}";\n' if use_import else f'require("{relative}");\n'

    if import_line.strip() in current:
        return True

    current = current.removeprefix(f'import "{relative_import(entrypoint_path, collector_file.with_suffix(""))}";\n')
    entrypoint_path.write_text(import_line + current, encoding="utf-8")
    return True

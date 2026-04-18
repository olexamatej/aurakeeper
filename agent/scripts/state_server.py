#!/usr/bin/env python3
"""Lightweight HTTP server that exposes orchestrator state files to the dashboard.

Usage:
    python scripts/state_server.py [--port 8787]

Endpoints:
    GET /api/state/agents  -> state/agents.json
    GET /api/state/issues  -> state/issues.json
    GET /api/state/prs     -> state/prs.json
"""
from __future__ import annotations

import argparse
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = ROOT / "state"

ROUTES: dict[str, tuple[Path, dict]] = {
    "/api/state/agents": (STATE_DIR / "agents.json", {"workers": [], "reviewers": [], "fix_workers": []}),
    "/api/state/issues": (STATE_DIR / "issues.json", {}),
    "/api/state/prs": (STATE_DIR / "prs.json", {}),
}


class StateHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        route = ROUTES.get(self.path)
        if route is None:
            self.send_error(404)
            return

        file_path, default = route
        if file_path.exists():
            try:
                data = json.loads(file_path.read_text())
            except (json.JSONDecodeError, OSError):
                data = default
        else:
            data = default

        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass  # suppress default stderr logging


def main() -> None:
    parser = argparse.ArgumentParser(description="AuraKeeper state API server")
    parser.add_argument("--port", type=int, default=8787, help="Port to listen on (default: 8787)")
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), StateHandler)
    print(f"State server listening on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()

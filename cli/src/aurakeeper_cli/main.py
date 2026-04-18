from __future__ import annotations

import argparse

from .commands.onboard import onboard
from .commands.start import start
from .commands.status import status
from .commands.worker_run import worker_run


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aurakeeper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    onboard_parser = subparsers.add_parser("onboard", help="Onboard a local repository")
    onboard_parser.add_argument("--repo", default=".", help="Repository path to onboard")
    onboard_parser.add_argument("--service", default=None, help="Service name override")
    onboard_parser.add_argument("--port", type=int, default=3000, help="Local backend port")
    onboard_parser.add_argument(
        "--admin-token",
        default="bahno",
        help="Admin token used when provisioning the local backend project",
    )
    onboard_parser.add_argument(
        "--no-auto-patch",
        action="store_true",
        help="Generate collector files without modifying an entrypoint",
    )
    onboard_parser.set_defaults(handler=onboard)

    start_parser = subparsers.add_parser("start", help="Start the local backend")
    start_parser.add_argument("--port", type=int, default=3000, help="Local backend port")
    start_parser.add_argument("--admin-token", default="bahno", help="Backend admin token")
    start_parser.add_argument(
        "--no-worker",
        action="store_true",
        help="Start only the backend without the local fix worker",
    )
    start_parser.set_defaults(handler=start)

    status_parser = subparsers.add_parser("status", help="Show local backend status")
    status_parser.add_argument("--repo", default=".", help="Repository path to inspect for project status")
    status_parser.set_defaults(handler=status)

    worker_parser = subparsers.add_parser("worker-run", help=argparse.SUPPRESS)
    worker_parser.add_argument("--port", type=int, required=True)
    worker_parser.add_argument("--admin-token", required=True)
    worker_parser.add_argument("--worker-id", required=True)
    worker_parser.set_defaults(handler=worker_run)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())

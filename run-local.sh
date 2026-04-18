#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_ENV_FILE="$BACKEND_DIR/.env"
FRONTEND_ENV_FILE="$FRONTEND_DIR/.env"

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    return 1
  fi
  return 0
}

ensure_bun_on_path() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  if [[ -x "$HOME/.bun/bin/bun" ]]; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  cat <<'EOF'
Bun is required but was not found on PATH.
Install it with:
  curl -fsSL https://bun.sh/install | bash
Then rerun this script.
EOF
  return 1
}

ensure_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if grep -Eq "^${key}=" "$file"; then
    return 0
  fi

  echo "${key}=${value}" >> "$file"
}

setup_env_files() {
  ensure_env_var "$BACKEND_ENV_FILE" "ADMIN_TOKEN" "bahno"
  ensure_env_var "$BACKEND_ENV_FILE" "CORS_ALLOWED_ORIGINS" "http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"
  ensure_env_var "$BACKEND_ENV_FILE" "DATABASE_PATH" "data/aurakeeper.sqlite"
  ensure_env_var "$BACKEND_ENV_FILE" "ARTIFACTS_PATH" "data/artifacts"
  ensure_env_var "$BACKEND_ENV_FILE" "PORT" "$BACKEND_PORT"
  ensure_env_var "$BACKEND_ENV_FILE" "CODEX_SANDBOX" "workspace-write"

  ensure_env_var "$FRONTEND_ENV_FILE" "VITE_ADMIN_TOKEN" "bahno"
  ensure_env_var "$FRONTEND_ENV_FILE" "VITE_API_URL" "http://127.0.0.1:${BACKEND_PORT}"
}

install_dependencies() {
  echo "Installing backend dependencies (Bun)..."
  (
    cd "$BACKEND_DIR"
    bun install --frozen-lockfile
  )

  echo "Installing frontend dependencies (pnpm)..."
  (
    cd "$FRONTEND_DIR"
    CI=true pnpm install --frozen-lockfile
  )
}

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  local code="$?"

  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$FRONTEND_PID" ]]; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  wait >/dev/null 2>&1 || true
  exit "$code"
}

start_services() {
  echo "Starting backend on http://127.0.0.1:${BACKEND_PORT} ..."
  (
    cd "$BACKEND_DIR"
    bun run dev
  ) &
  BACKEND_PID=$!

  echo "Starting frontend on http://${FRONTEND_HOST}:${FRONTEND_PORT} ..."
  (
    cd "$FRONTEND_DIR"
    pnpm dev --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  ) &
  FRONTEND_PID=$!

  echo "AuraKeeper local stack is running. Press Ctrl+C to stop both services."

  wait -n "$BACKEND_PID" "$FRONTEND_PID"
}

main() {
  ensure_bun_on_path
  require_command pnpm

  setup_env_files
  install_dependencies

  trap cleanup EXIT INT TERM
  start_services
}

main "$@"

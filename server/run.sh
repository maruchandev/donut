#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

export PATH="$HOME/.local/bin:$PATH"

ENV_FILE="${ENV_FILE:-$HERE/.env}"
[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8765}"
RELOAD="${RELOAD:-true}"

exec uvicorn main:app --host "$HOST" --port "$PORT" ${RELOAD:+--reload}

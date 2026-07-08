#!/usr/bin/env bash
# Cloudflare Tunnel launcher for どーなつ (stream-translator)
#
# Usage:
#   ./scripts/tunnel.sh quick          # trycloudflare.com (no account setup)
#   ./scripts/tunnel.sh named          # use ~/.cloudflared/config.yml
#   ./scripts/tunnel.sh quick --no-app # tunnel only (app already running)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/server"
PORT="${PORT:-8765}"
APP_URL="http://127.0.0.1:${PORT}"
MODE="${1:-quick}"
START_APP=1

if [[ "${2:-}" == "--no-app" ]]; then
  START_APP=0
fi

export PATH="$HOME/.local/bin:$PATH"

wait_for_app() {
  local i
  for i in $(seq 1 40); do
    if curl -sf "$APP_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "App did not become ready at $APP_URL" >&2
  return 1
}

start_app() {
  if curl -sf "$APP_URL/health" >/dev/null 2>&1; then
    echo "App already running at $APP_URL"
    return 0
  fi
  echo "Starting app on $APP_URL ..."
  cd "$SERVER_DIR"
  RELOAD=false HOST=127.0.0.1 PORT="$PORT" bash run.sh &
  APP_PID=$!
  echo "$APP_PID" > /tmp/donut-app.pid
  wait_for_app
}

start_quick_tunnel() {
  echo "Starting Cloudflare Quick Tunnel -> $APP_URL"
  echo "(Public URL will appear below as https://....trycloudflare.com)"
  echo ""
  exec cloudflared tunnel --url "$APP_URL" --no-autoupdate
}

start_named_tunnel() {
  local cfg="${CLOUDFLARE_CONFIG:-$HOME/.cloudflared/config.yml}"
  if [[ ! -f "$cfg" ]]; then
    echo "Missing Cloudflare config: $cfg" >&2
    echo "Copy cloudflare/config.yml.example and complete setup first." >&2
    exit 1
  fi
  echo "Starting named Cloudflare Tunnel using $cfg"
  exec cloudflared tunnel --config "$cfg" run
}

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi

if [[ "$START_APP" == "1" ]]; then
  start_app
fi

case "$MODE" in
  quick) start_quick_tunnel ;;
  named) start_named_tunnel ;;
  *)
    echo "Usage: $0 [quick|named] [--no-app]" >&2
    exit 1
    ;;
esac
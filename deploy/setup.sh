#!/usr/bin/env bash
# Install systemd units on Ubuntu (run on the server as root or with sudo)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/setup.sh [quick|named]" >&2
  exit 1
fi

TUNNEL_MODE="${1:-quick}"

install -m 644 "$DEPLOY/donut.service" /etc/systemd/system/donut.service

case "$TUNNEL_MODE" in
  quick)
    install -m 644 "$DEPLOY/cloudflared-quick.service" /etc/systemd/system/cloudflared.service
    ;;
  named)
    if [[ ! -f /home/ubuntu/.cloudflared/config.yml ]]; then
      echo "Missing /home/ubuntu/.cloudflared/config.yml — set up named tunnel first." >&2
      exit 1
    fi
    install -m 644 "$DEPLOY/cloudflared-named.service" /etc/systemd/system/cloudflared.service
    ;;
  *)
    echo "Usage: sudo bash deploy/setup.sh [quick|named]" >&2
    exit 1
    ;;
esac

systemctl daemon-reload
systemctl enable donut.service cloudflared.service
echo ""
echo "Installed. Next:"
echo "  1. Ensure /home/ubuntu/donut/server/.env is configured (RELOAD=false, API_KEY, ADMIN_CERT_FINGERPRINTS)"
echo "  2. sudo systemctl start donut.service"
echo "  3. sudo systemctl start cloudflared.service"
echo "  4. sudo systemctl status donut.service cloudflared.service"
echo "  5. journalctl -u cloudflared.service -f   # copy the public URL (quick tunnel)"
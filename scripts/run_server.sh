#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d .venv ]]; then
  echo "[ERROR] .venv not found. Run: python3 -m venv .venv && . .venv/bin/activate && python -m pip install -r requirements.txt"
  exit 1
fi

# Always bind to all interfaces so LAN devices can reach the app.
export APP_HOST="0.0.0.0"
export APP_PORT="${APP_PORT:-5000}"
export APP_DEBUG="${APP_DEBUG:-false}"

HOSTNAME_LOCAL="$(hostname).local"
LAN_IP="$(hostname -I | awk '{print $1}')"

echo "Fish Counter starting..."
echo "Stable URL (same even if Wi-Fi IP changes): http://${HOSTNAME_LOCAL}:${APP_PORT}"
echo "Current LAN URL: http://${LAN_IP}:${APP_PORT}"
echo

. .venv/bin/activate
exec python app.py

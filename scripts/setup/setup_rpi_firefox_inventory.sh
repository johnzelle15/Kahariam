#!/usr/bin/env bash
set -euo pipefail

resolve_local_hostname() {
  local host
  host="$(hostname 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$host" ]; then
    echo "localhost"
    return
  fi

  case "$host" in
    localhost|*.local)
      echo "$host"
      ;;
    *)
      echo "${host}.local"
      ;;
  esac
}

APP_HOST="${APP_HOST:-$(resolve_local_hostname)}"
APP_URL="${APP_URL:-http://${APP_HOST}:5000/?tab=dashboard}"
ZOOM_PERCENT="${ZOOM_PERCENT:-67}"
INSTALL_PACKAGES="${INSTALL_PACKAGES:-1}"
PROFILE_NAME="${PROFILE_NAME:-fish-counter-profile}"

if ! [[ "$ZOOM_PERCENT" =~ ^[0-9]+$ ]]; then
  echo "ZOOM_PERCENT must be a number (example: 67)"
  exit 1
fi

if [ "$ZOOM_PERCENT" -lt 30 ] || [ "$ZOOM_PERCENT" -gt 300 ]; then
  echo "ZOOM_PERCENT must be between 30 and 300"
  exit 1
fi

if [ "$EUID" -eq 0 ]; then
  echo "Run this as your desktop user (not root)."
  echo "Example: APP_URL=http://$(resolve_local_hostname):5000/?tab=dashboard ZOOM_PERCENT=67 ./scripts/setup_rpi_firefox_inventory.sh"
  exit 1
fi

if [ "$INSTALL_PACKAGES" = "1" ]; then
  MISSING_PKGS=()
  if ! command -v firefox-esr >/dev/null 2>&1 && ! command -v firefox >/dev/null 2>&1; then
    MISSING_PKGS+=("firefox-esr")
  fi

  if [ "${#MISSING_PKGS[@]}" -gt 0 ]; then
    sudo apt update
    sudo apt install -y "${MISSING_PKGS[@]}"
  fi
fi

if command -v firefox-esr >/dev/null 2>&1; then
  FIREFOX_BIN="firefox-esr"
elif command -v firefox >/dev/null 2>&1; then
  FIREFOX_BIN="firefox"
else
  echo "Firefox not found. Install it first or run with INSTALL_PACKAGES=1."
  exit 1
fi

mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.config/autostart"

FIREFOX_PROFILE_DIR="$HOME/.mozilla/firefox/$PROFILE_NAME"
mkdir -p "$FIREFOX_PROFILE_DIR"

DEV_PIXELS_PER_PX="$(awk "BEGIN { printf \"%.2f\", $ZOOM_PERCENT/100 }")"

cat > "$FIREFOX_PROFILE_DIR/user.js" <<EOF
user_pref("layout.css.devPixelsPerPx", "$DEV_PIXELS_PER_PX");
user_pref("browser.startup.homepage", "$APP_URL");
user_pref("browser.startup.page", 1);
user_pref("browser.sessionstore.resume_from_crash", false);
EOF

cat > "$HOME/.local/bin/fish-counter-firefox-start.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL}"
FIREFOX_BIN="${FIREFOX_BIN}"
FIREFOX_PROFILE_DIR="${FIREFOX_PROFILE_DIR}"

# Give network + desktop session time to settle
sleep 8

# Close old firefox windows from previous session to avoid duplicates
pkill -x firefox-esr || true
pkill -x firefox || true
sleep 1

"\$FIREFOX_BIN" -no-remote --profile "\$FIREFOX_PROFILE_DIR" --new-window "\$APP_URL" >/dev/null 2>&1 &
EOF

chmod +x "$HOME/.local/bin/fish-counter-firefox-start.sh"

cat > "$HOME/.config/autostart/fish-counter-firefox.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Fish Counter Firefox Autostart
Exec=$HOME/.local/bin/fish-counter-firefox-start.sh
X-GNOME-Autostart-enabled=true
Terminal=false
EOF

echo "Installed Firefox autostart."
echo "URL: $APP_URL"
echo "Zoom: ${ZOOM_PERCENT}%"
echo "Scale pref (layout.css.devPixelsPerPx): $DEV_PIXELS_PER_PX"
echo "Profile: $FIREFOX_PROFILE_DIR"
echo "Install packages step: $INSTALL_PACKAGES"
echo "Reboot or log out/in to test."

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CSI Global Shutter Camera Setup for Raspberry Pi 5
# ─────────────────────────────────────────────────────────────────────────────
# Configures the Raspberry Pi Global Shutter Camera (Sony IMX296, 1456x1088)
# connected via CSI ribbon cable for optimal fish counting performance.
#
# What this script does:
#   1. Detects whether a CSI camera is connected (aborts if USB-only)
#   2. Enables the correct device-tree overlay for the IMX296 sensor
#   3. Sets Picamera2 controls to eliminate banding / flicker
#   4. Writes env vars that fish_counter.py reads at startup
#
# Usage:
#   chmod +x scripts/setup/setup_csi_global_shutter.sh
#   sudo ./scripts/setup/setup_csi_global_shutter.sh
#
# After running, reboot for /boot/firmware/config.txt changes to take effect,
# then start the counter normally:
#   source .venv/bin/activate && python run_counter.py
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── 0. Root check ────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "[ERROR] This script must be run as root (sudo)."
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
BOOT_CONFIG="/boot/firmware/config.txt"
# Fallback for older Raspberry Pi OS layouts
[[ -f "$BOOT_CONFIG" ]] || BOOT_CONFIG="/boot/config.txt"

echo "============================================================"
echo "  CSI Global Shutter Camera Setup – Raspberry Pi 5"
echo "============================================================"

# ── 1. Detect CSI camera ────────────────────────────────────────────────────
echo "[INFO] Detecting CSI camera..."

CSI_DETECTED=false

# Method 1: libcamera (preferred on RPi5 / Bookworm)
if command -v libcamera-hello &>/dev/null; then
    if libcamera-hello --list-cameras 2>&1 | grep -qi "imx296"; then
        CSI_DETECTED=true
        echo "[INFO] IMX296 global shutter camera detected via libcamera."
    fi
fi

# Method 2: rpicam-hello (newer naming)
if [[ "$CSI_DETECTED" == false ]] && command -v rpicam-hello &>/dev/null; then
    if rpicam-hello --list-cameras 2>&1 | grep -qi "imx296"; then
        CSI_DETECTED=true
        echo "[INFO] IMX296 global shutter camera detected via rpicam."
    fi
fi

# Method 3: v4l2 device presence (CSI cameras appear as /dev/video* via bcm2835)
if [[ "$CSI_DETECTED" == false ]]; then
    for dev in /dev/video*; do
        if [[ -e "$dev" ]] && v4l2-ctl --device="$dev" --all 2>/dev/null | grep -qi "imx296\|bcm2835-isp"; then
            CSI_DETECTED=true
            echo "[INFO] CSI camera detected via V4L2 ($dev)."
            break
        fi
    done
fi

if [[ "$CSI_DETECTED" == false ]]; then
    echo "[WARN] No CSI global shutter camera (IMX296) detected."
    echo "       If the camera is USB-connected, no changes are needed."
    echo "       If you just connected the ribbon cable, reboot first."
    exit 0
fi

# ── 2. Device-tree overlay ───────────────────────────────────────────────────
echo "[INFO] Ensuring IMX296 device-tree overlay is enabled..."

if ! grep -q "^dtoverlay=imx296" "$BOOT_CONFIG" 2>/dev/null; then
    # Add the overlay under [all] or at the end
    echo "" >> "$BOOT_CONFIG"
    echo "# Raspberry Pi Global Shutter Camera (IMX296) – added by setup_csi_global_shutter.sh" >> "$BOOT_CONFIG"
    echo "dtoverlay=imx296" >> "$BOOT_CONFIG"
    echo "[INFO] Added dtoverlay=imx296 to $BOOT_CONFIG"
    NEEDS_REBOOT=true
else
    echo "[INFO] dtoverlay=imx296 already present in $BOOT_CONFIG"
    NEEDS_REBOOT=false
fi

# ── 3. IMX296 native specs ──────────────────────────────────────────────────
# Sony IMX296 specs (Raspberry Pi Global Shutter Camera):
#   Sensor:        1/2.9" CMOS, global shutter
#   Max resolution: 1456 x 1088
#   Max frame rate:  60 fps (full resolution)
#   Pixel size:     3.45 µm
#   Interface:      CSI-2 (2-lane on RPi5)
#
# Because this is a global shutter sensor, there is no rolling-shutter
# banding.  However, flicker / banding CAN appear from artificial lighting
# at 50 Hz or 60 Hz mains frequency.  The fix is to lock the exposure
# time to an integer multiple of the mains period:
#   50 Hz → 10 000 µs (1/100 s) or 20 000 µs (1/50 s)
#   60 Hz → 8 333 µs  (1/120 s) or 16 667 µs (1/60 s)

# ── 4. Detect mains frequency (best-effort) ─────────────────────────────────
# Default to 50 Hz (Europe / Asia / Oceania / Africa / most of South America)
MAINS_HZ="${MAINS_HZ:-50}"
echo "[INFO] Mains frequency: ${MAINS_HZ} Hz (override with MAINS_HZ=60 if needed)"

if [[ "$MAINS_HZ" == "60" ]]; then
    # Lock to 1/120 s = 8333 µs  (fits 60 fps nicely)
    EXPOSURE_US=8333
else
    # Lock to 1/100 s = 10000 µs (fits 50 fps; sensor can still do 60 fps)
    EXPOSURE_US=10000
fi

# ── 5. Write / update .env ───────────────────────────────────────────────────
echo "[INFO] Writing CSI global shutter settings to $ENV_FILE ..."

# Helper: set key=value in .env, creating or replacing as needed.
set_env_var() {
    local key="$1" val="$2"
    if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE"; then
        # Use a temp file for in-place edit (portable across sed versions)
        local tmp
        tmp=$(mktemp)
        sed "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
    else
        echo "${key}=${val}" >> "$ENV_FILE"
    fi
}

# Disable USB mode so that Picamera2 (CSI) path is used
set_env_var "USB_CAMERA_MODE"        "false"

# IMX296 native max at full resolution
set_env_var "CAMERA_FPS"             "60"
set_env_var "CAMERA_FORCE_FPS_LOCK"  "true"

# Full sensor resolution (will be downscaled by the ISP as needed)
set_env_var "CAPTURE_WIDTH"          "1456"
set_env_var "CAPTURE_HEIGHT"         "1088"

# Anti-flicker: lock exposure to an integer multiple of mains period
# This is applied as a Picamera2 control in fish_counter.py
set_env_var "CSI_FIXED_EXPOSURE_US"  "$EXPOSURE_US"

# Disable auto-white-balance flicker by locking AWB mode
set_env_var "CSI_AWB_MODE"           "auto"

# Analogue gain — let the sensor auto-adjust within a sane range
set_env_var "CSI_ANALOGUE_GAIN_MIN"  "1.0"
set_env_var "CSI_ANALOGUE_GAIN_MAX"  "8.0"

# Disable blue-cast fix (IMX296 has accurate colour with locked exposure)
set_env_var "BLUE_CAST_FIX_ENABLE"   "false"

# Processing settings tuned for 60 fps global shutter feed
set_env_var "FPS_TARGET"             "60"
set_env_var "FRAME_SKIP"            "1"
set_env_var "INPUT_SIZE"             "480"

# Fix ownership if we created/modified the file as root
if [[ -n "${SUDO_USER:-}" ]]; then
    chown "${SUDO_USER}:${SUDO_USER}" "$ENV_FILE"
fi

echo "[INFO] .env updated successfully."

# ── 6. Print summary ────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Configuration Summary"
echo "────────────────────────────────────────────────────────────"
echo "  Camera:           IMX296 Global Shutter (CSI)"
echo "  Resolution:       1456 x 1088"
echo "  Frame rate:       60 fps (sensor native max)"
echo "  Exposure lock:    ${EXPOSURE_US} µs (anti-flicker @ ${MAINS_HZ} Hz)"
echo "  USB camera mode:  DISABLED"
echo "  Blue-cast fix:    DISABLED (not needed for IMX296)"
echo "  Frame skip:       1 (process every frame)"
echo "────────────────────────────────────────────────────────────"

if [[ "${NEEDS_REBOOT:-false}" == true ]]; then
    echo ""
    echo "  *** REBOOT REQUIRED ***"
    echo "  The device-tree overlay was added. Run:"
    echo "      sudo reboot"
    echo ""
fi

echo "[DONE] CSI global shutter camera setup complete."

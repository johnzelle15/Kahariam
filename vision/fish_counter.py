"""
Fish Counter - Optimized for Raspberry Pi 5

This module implements a real-time fish counting system with:
- Virtual line counting with hysteresis-based zone detection
- Smooth centroid tracking with EMA smoothing
- Detection flickering prevention
- Performance optimizations for edge devices

Key Optimizations for RPi5:
--------------------------
1. ROI-based detection: Only process the area around the counting line
2. Frame skipping: Process every Nth frame for detection
3. ONNX runtime: Use optimized ONNX model when available
4. Efficient tracking: Lightweight centroid tracker with NumPy vectorization
5. Configurable resolution: Run at optimal 480x480 for speed

Virtual Line Counting Logic:
---------------------------
Fish are counted when they cross from the TOP zone to the BOTTOM zone.
A hysteresis band prevents double-counting when fish hover near the line.

    +----------------------------------+
    |         TOP ZONE                 |  <- Objects here are "above line"
    |----------------------------------|  <- Upper hysteresis boundary
    |       HYSTERESIS BAND            |  <- Objects here are "at line"
    |==================================|  <- THE COUNTING LINE
    |       HYSTERESIS BAND            |  <- Objects here are "at line"
    |----------------------------------|  <- Lower hysteresis boundary
    |         BOTTOM ZONE              |  <- Objects here are "below line"
    +----------------------------------+

A fish is counted when:
1. last_zone == 'top' AND current_zone == 'bottom' (crossed downward)
2. At least MIN_CROSSING_FRAMES have passed since last count
3. Track age >= MIN_TRACK_AGE (prevents false positives from flickering)

Author: Fish Counter Project
"""
import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

# Add project root to sys.path so 'backend' and 'vision' imports work when run as subprocess
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

# Load .env early so DISPLAY overrides are available before Qt init
try:
    from dotenv import load_dotenv as _early_dotenv
    _early_dotenv(dotenv_path=_project_root / '.env')
except Exception:
    pass

# Prevent Qt crash on headless systems (no X display)
if not os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

import cv2
import numpy as np
import torch
from ultralytics import YOLO

from backend.core.config import INGEST_URL, LEGACY_UPDATE_COUNT_URL
from vision.tracker import CentroidTracker, TrackedObject
from vision.kalman_tracker import KalmanSortTracker

# Class names must match the model's training order.
# NOTE: the trained model still emits 3 class indices (0/1/2) from the old
# Black/Pineapple/Platinum labels. Collapsing to a single SPIN_20 class here
# is a labeling-only change — detections with class_id 1 or 2 will fall back
# to "Unknown" until the model is retrained on the SPIN_20 label set.
CLASS_NAMES = ['SPIN_20']
CLASS_COLORS_BGR = [
    (76, 122, 61),    # SPIN_20
]

MODEL_PATH = os.environ.get('MODEL_PATH', '/home/aquaculture/Fish-Counter/models/fish_detector.onnx')
MODEL_FALLBACK_PATH = os.environ.get('MODEL_FALLBACK_PATH', '/home/aquaculture/Fish-Counter/models/fish_detector.pt')


def _load_dotenv_early() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass


_load_dotenv_early()


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


def env_int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except Exception:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def env_float(name: str, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except Exception:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


CAMERA_ID = env_int('CAMERA_ID', 0, minimum=0)
CAMERA_FPS = env_int('CAMERA_FPS', 60, minimum=5, maximum=120)
CAMERA_FORCE_FPS_LOCK = env_bool('CAMERA_FORCE_FPS_LOCK', False)
LINE_POSITION = env_int('LINE_POSITION', 200, minimum=0)
CONFIDENCE_THRESHOLD = env_float('CONFIDENCE_THRESHOLD', 0.50, minimum=0.01, maximum=0.95)
TRACK_IOU_THRESHOLD = env_float('TRACK_IOU_THRESHOLD', 0.45, minimum=0.05, maximum=0.95)
FPS_TARGET = env_int('FPS_TARGET', 60, minimum=5, maximum=120)
FRAME_DELAY = int(1000 / FPS_TARGET)
FRAME_SKIP = env_int('FRAME_SKIP', 1, minimum=1, maximum=6)

USE_GPU = env_bool('USE_GPU', False)
SHOW_PREVIEW_WINDOW = env_bool(
    'SHOW_PREVIEW_WINDOW',
    bool(os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY')),
)
INPUT_SIZE = env_int('INPUT_SIZE', 480, minimum=320, maximum=960)
CAPTURE_WIDTH = env_int('CAPTURE_WIDTH', 640, minimum=320, maximum=1920)
CAPTURE_HEIGHT = env_int('CAPTURE_HEIGHT', 360, minimum=240, maximum=1080)
ROI_BAND_HEIGHT = env_int('ROI_BAND_HEIGHT', 200, minimum=40)
LINE_HYSTERESIS_PX = env_int('LINE_HYSTERESIS_PX', 60, minimum=4)
MIN_CROSSING_FRAMES = env_int('MIN_CROSSING_FRAMES', 12, minimum=1, maximum=120)

# ─────────────────────────────────────────────────────────────────────────────
# Classification Filtering
# ─────────────────────────────────────────────────────────────────────────────
# Minimum confidence to trust the class label.  Detections with confidence
# below this threshold are kept for tracking but their class_id is set to
# the dominant class in their recent history, reducing false positives from
# low-confidence mis-classifications.
CLASS_CONF_THRESHOLD = env_float('CLASS_CONF_THRESHOLD', 0.55, minimum=0.0, maximum=1.0)

# ─────────────────────────────────────────────────────────────────────────────
# USB Camera Configuration (for USB webcams like EMEET C60E)
# ─────────────────────────────────────────────────────────────────────────────
# These settings optimize performance for USB webcams on Raspberry Pi 5

USB_CAMERA_MODE = env_bool('USB_CAMERA_MODE', True)  # Use USB camera optimizations
USB_CAMERA_BACKEND = os.environ.get('USB_CAMERA_BACKEND', 'v4l2').strip().lower()  # v4l2, auto, any
USB_CAMERA_BUFFER_SIZE = env_int('USB_CAMERA_BUFFER_SIZE', 1, minimum=1, maximum=10)  # Reduce latency
USB_CAMERA_FOURCC = os.environ.get('USB_CAMERA_FOURCC', 'MJPG').strip().upper()  # MJPG, YUYV, auto
USB_CAMERA_AUTOFOCUS = env_bool('USB_CAMERA_AUTOFOCUS', True)  # Enable autofocus if supported
USB_CAMERA_AUTO_EXPOSURE = env_bool('USB_CAMERA_AUTO_EXPOSURE', True)  # Enable auto exposure

ENABLE_FRAME_AUTOFIX = env_bool('ENABLE_FRAME_AUTOFIX', False)
BLUE_CAST_FIX_ENABLE = env_bool('BLUE_CAST_FIX_ENABLE', False)
BLUE_CAST_BRIGHTNESS_THRESHOLD = env_float('BLUE_CAST_BRIGHTNESS_THRESHOLD', 165.0, minimum=0.0, maximum=255.0)
BLUE_CAST_RATIO_THRESHOLD = env_float('BLUE_CAST_RATIO_THRESHOLD', 1.08, minimum=1.0, maximum=2.0)
BLUE_CAST_MAX_REDUCTION = env_float('BLUE_CAST_MAX_REDUCTION', 0.18, minimum=0.0, maximum=0.6)
SHARPEN_STRENGTH = env_float('SHARPEN_STRENGTH', 0.28, minimum=0.0, maximum=1.0)
SHARPEN_SIGMA = env_float('SHARPEN_SIGMA', 1.2, minimum=0.5, maximum=3.0)

# ─────────────────────────────────────────────────────────────────────────────
# CSI Global Shutter Camera Configuration (e.g. IMX296)
# ─────────────────────────────────────────────────────────────────────────────
# These are only applied when USB_CAMERA_MODE is False (Picamera2 path).
# Set CSI_FIXED_EXPOSURE_US to lock exposure and eliminate flicker/banding
# under artificial lighting.  Value should be an integer multiple of the
# mains period: 50 Hz → 10000 µs, 60 Hz → 8333 µs.

CSI_FIXED_EXPOSURE_US = env_int('CSI_FIXED_EXPOSURE_US', 0, minimum=0)  # 0 = auto
CSI_AWB_MODE = os.environ.get('CSI_AWB_MODE', 'auto').strip().lower()
CSI_ANALOGUE_GAIN_MIN = env_float('CSI_ANALOGUE_GAIN_MIN', 1.0, minimum=1.0, maximum=16.0)
CSI_ANALOGUE_GAIN_MAX = env_float('CSI_ANALOGUE_GAIN_MAX', 8.0, minimum=1.0, maximum=16.0)

# Manual colour gains: override AWB with fixed red/blue gains.
# Set both to 0.0 to use automatic white balance.
# Typical values for IMX296 under indoor lighting: red ~3.1, blue ~1.7
CSI_RED_GAIN = env_float('CSI_RED_GAIN', 0.0, minimum=0.0, maximum=32.0)
CSI_BLUE_GAIN = env_float('CSI_BLUE_GAIN', 0.0, minimum=0.0, maximum=32.0)

# AWB lock: let AWB auto-converge for N seconds, then freeze the gains.
# Prevents colour drift / hunting.  Ignored when manual gains are set.
CSI_AWB_LOCK = env_bool('CSI_AWB_LOCK', True)
CSI_AWB_LOCK_DELAY = env_float('CSI_AWB_LOCK_DELAY', 2.0, minimum=0.5, maximum=10.0)

# Colour saturation: 1.0 = normal, <1.0 = muted, >1.0 = vivid.
CSI_SATURATION = env_float('CSI_SATURATION', 1.0, minimum=0.0, maximum=4.0)

FRAME_ROTATE = env_int('FRAME_ROTATE', 0, minimum=0, maximum=270)
LINE_POSITION_PERCENT = env_float('LINE_POSITION_PERCENT', 85.0, minimum=-1.0, maximum=100.0)
PREVIEW_SCALE = env_float('PREVIEW_SCALE', 1.0, minimum=0.2, maximum=1.0)
PREVIEW_MAX_WIDTH = env_int('PREVIEW_MAX_WIDTH', 0, minimum=0, maximum=3840)
PREVIEW_MAX_HEIGHT = env_int('PREVIEW_MAX_HEIGHT', 0, minimum=0, maximum=2160)

# ─────────────────────────────────────────────────────────────────────────────
# Tracker Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Controls for the centroid tracker that provides stable object tracking

TRACKER_MAX_DISAPPEARED = env_int('TRACKER_MAX_DISAPPEARED', 5, minimum=1, maximum=60)
TRACKER_MAX_DISTANCE = env_float('TRACKER_MAX_DISTANCE', 80.0, minimum=20.0, maximum=300.0)
TRACKER_EMA_ALPHA = env_float('TRACKER_EMA_ALPHA', 0.6, minimum=0.1, maximum=1.0)
MIN_TRACK_AGE_FOR_COUNT = env_int('MIN_TRACK_AGE_FOR_COUNT', 5, minimum=1, maximum=20)

# Enable/disable YOLO's built-in tracker (falls back to centroid tracker if disabled)
USE_YOLO_TRACKER = env_bool('USE_YOLO_TRACKER', True)

# ─── Kalman / SORT Tracker ───────────────────────────────────────────────────
# Set USE_KALMAN_TRACKER=true to use the SORT-style Kalman filter tracker
# instead of the legacy centroid tracker. Provides motion prediction,
# IoU-based matching, and better handling of fast-moving fish.
USE_KALMAN_TRACKER = env_bool('USE_KALMAN_TRACKER', True)
KALMAN_MAX_AGE = env_int('KALMAN_MAX_AGE', 20, minimum=1, maximum=60)
KALMAN_MIN_HITS = env_int('KALMAN_MIN_HITS', 3, minimum=1, maximum=10)
KALMAN_IOU_THRESHOLD = env_float('KALMAN_IOU_THRESHOLD', 0.20, minimum=0.05, maximum=0.90)

# Bidirectional counting: 'down' = top-to-bottom, 'up' = bottom-to-top, 'both' = count both
COUNTING_DIRECTION = os.environ.get('COUNTING_DIRECTION', 'down').strip().lower()

# Performance optimizations
ENABLE_HALF_PRECISION = env_bool('ENABLE_HALF_PRECISION', False)  # FP16 mode (GPU only)
ADAPTIVE_FRAME_SKIP = env_bool('ADAPTIVE_FRAME_SKIP', False)  # Adjust skip based on detections
WARMUP_FRAMES = env_int('WARMUP_FRAMES', 2, minimum=1, maximum=30)  # Model warmup iterations

# ─────────────────────────────────────────────────────────────────────────────
# Visualization Colors (BGR format)
# ─────────────────────────────────────────────────────────────────────────────
COLOR_BOX = (0, 255, 0)         # Green: bounding boxes
COLOR_BOX_COUNTED = (255, 0, 255)  # Magenta: recently counted fish
COLOR_LINE = (255, 0, 0)        # Blue: counting line
COLOR_LINE_ZONE = (255, 200, 0) # Cyan: hysteresis zone boundaries
COLOR_COUNTER = (0, 0, 255)     # Red: counter text
COLOR_TRACK_ID = (255, 255, 0)  # Cyan: track ID labels
COLOR_CENTROID = (0, 255, 255)  # Yellow: centroid dots


@dataclass
class CaptureAdapter:
    read: callable
    release: callable


def apply_frame_rotation(frame):
    if FRAME_ROTATE == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if FRAME_ROTATE == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    if FRAME_ROTATE == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def apply_frame_autofix(frame):
    if not ENABLE_FRAME_AUTOFIX:
        return frame

    out = frame

    if BLUE_CAST_FIX_ENABLE:
        b_mean, g_mean, r_mean, _ = cv2.mean(out)
        luminance = (0.114 * b_mean) + (0.587 * g_mean) + (0.299 * r_mean)
        if (
            luminance >= BLUE_CAST_BRIGHTNESS_THRESHOLD
            and b_mean > (g_mean * BLUE_CAST_RATIO_THRESHOLD)
            and b_mean > (r_mean * BLUE_CAST_RATIO_THRESHOLD)
        ):
            target_blue = (g_mean + r_mean) / 2.0
            desired_scale = target_blue / max(b_mean, 1e-6)
            min_scale = 1.0 - BLUE_CAST_MAX_REDUCTION
            blue_scale = max(min_scale, min(1.0, desired_scale))
            fixed = out.astype('float32')
            fixed[:, :, 0] *= blue_scale
            out = fixed.clip(0, 255).astype('uint8')

    if SHARPEN_STRENGTH > 0.0:
        blurred = cv2.GaussianBlur(out, (0, 0), SHARPEN_SIGMA)
        out = cv2.addWeighted(out, 1.0 + SHARPEN_STRENGTH, blurred, -SHARPEN_STRENGTH, 0)

    return out


def compute_line_y(frame_h: int) -> int:
    if LINE_POSITION_PERCENT >= 0:
        return min(max(int(frame_h * (LINE_POSITION_PERCENT / 100.0)), 0), frame_h - 1)
    return min(max(LINE_POSITION, 0), frame_h - 1)


def build_preview_frame(frame):
    preview = frame

    if PREVIEW_SCALE < 0.999:
        new_w = max(1, int(preview.shape[1] * PREVIEW_SCALE))
        new_h = max(1, int(preview.shape[0] * PREVIEW_SCALE))
        preview = cv2.resize(preview, (new_w, new_h), interpolation=cv2.INTER_AREA)

    if PREVIEW_MAX_WIDTH > 0 or PREVIEW_MAX_HEIGHT > 0:
        scale_w = (PREVIEW_MAX_WIDTH / preview.shape[1]) if PREVIEW_MAX_WIDTH > 0 else 1.0
        scale_h = (PREVIEW_MAX_HEIGHT / preview.shape[0]) if PREVIEW_MAX_HEIGHT > 0 else 1.0
        fit_scale = min(scale_w, scale_h, 1.0)
        if fit_scale < 0.999:
            new_w = max(1, int(preview.shape[1] * fit_scale))
            new_h = max(1, int(preview.shape[0] * fit_scale))
            preview = cv2.resize(preview, (new_w, new_h), interpolation=cv2.INTER_AREA)

    return preview


def _get_opencv_backend() -> int:
    """
    Get the OpenCV backend API based on configuration.
    
    For USB webcams on Linux (Raspberry Pi), V4L2 provides:
    - Better buffer control for reduced latency
    - MJPEG codec support for higher frame rates
    - Direct hardware access
    
    Returns:
        OpenCV backend constant (e.g., cv2.CAP_V4L2)
    """
    backend_map = {
        'v4l2': cv2.CAP_V4L2,
        'v4l': cv2.CAP_V4L2,
        'auto': cv2.CAP_ANY,
        'any': cv2.CAP_ANY,
        'gstreamer': cv2.CAP_GSTREAMER,
        'dshow': cv2.CAP_DSHOW,  # Windows DirectShow
    }
    return backend_map.get(USB_CAMERA_BACKEND, cv2.CAP_ANY)


def _get_fourcc_code() -> int | None:
    """
    Get the FourCC codec code for USB camera.
    
    MJPG is preferred for USB webcams because:
    - Lower USB bandwidth usage
    - Higher achievable frame rates
    - Hardware JPEG decoding on most cameras
    
    Returns:
        FourCC code or None for auto-selection
    """
    if USB_CAMERA_FOURCC == 'AUTO' or not USB_CAMERA_FOURCC:
        return None
    try:
        return cv2.VideoWriter_fourcc(*USB_CAMERA_FOURCC[:4])
    except Exception:
        return None


def _configure_usb_camera(cap: cv2.VideoCapture) -> None:
    """
    Apply USB camera-specific optimizations.
    
    Optimizations for Raspberry Pi 5 with USB webcams:
    - Buffer size reduction for lower latency
    - MJPEG codec for higher frame rates
    - Autofocus and auto-exposure settings
    
    Args:
        cap: OpenCV VideoCapture instance
    """
    # Set resolution and frame rate
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
    
    # Set FourCC codec (MJPG recommended for USB cameras)
    fourcc = _get_fourcc_code()
    if fourcc is not None:
        cap.set(cv2.CAP_PROP_FOURCC, fourcc)
    
    # Reduce buffer size to minimize latency (critical for real-time counting)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, USB_CAMERA_BUFFER_SIZE)
    
    # Configure autofocus
    if USB_CAMERA_AUTOFOCUS:
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
    else:
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
    
    # Configure auto-exposure
    if USB_CAMERA_AUTO_EXPOSURE:
        # 0.75 = auto, 0.25 = manual on many cameras
        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.75)


def _open_usb_camera() -> CaptureAdapter | None:
    """
    Open a USB webcam with optimized settings for Raspberry Pi 5.
    
    Supports cameras like:
    - EMEET C60E 4K
    - Logitech C920/C922
    - Generic UVC webcams
    
    Returns:
        CaptureAdapter if successful, None otherwise
    """
    backend = _get_opencv_backend()
    backend_name = USB_CAMERA_BACKEND.upper()
    
    print(f"[INFO] Opening USB camera {CAMERA_ID} with {backend_name} backend...")

    # Pre-configure camera with v4l2-ctl before OpenCV opens it.
    # This locks in MJPG format and frame rate at the driver level,
    # which is more reliable than relying on OpenCV's CAP_PROP setters.
    device_path = f"/dev/video{CAMERA_ID}"
    try:
        import subprocess
        subprocess.run(
            ['v4l2-ctl', f'--device={device_path}',
             f'--set-fmt-video=width={CAPTURE_WIDTH},height={CAPTURE_HEIGHT},pixelformat={USB_CAMERA_FOURCC}'],
            capture_output=True, timeout=5,
        )
        subprocess.run(
            ['v4l2-ctl', f'--device={device_path}',
             f'--set-parm={CAMERA_FPS}'],
            capture_output=True, timeout=5,
        )
        print(f"[INFO] v4l2-ctl: pre-configured {device_path} → "
              f"{CAPTURE_WIDTH}x{CAPTURE_HEIGHT} {USB_CAMERA_FOURCC} @ {CAMERA_FPS}fps")
    except FileNotFoundError:
        print("[WARN] v4l2-ctl not found, skipping pre-configuration")
    except Exception as exc:
        print(f"[WARN] v4l2-ctl pre-config failed: {exc}")

    # On RPi5, opening by device path is more reliable than by index
    # because libcamera's ISP nodes (/dev/video20+) can confuse index mapping.
    device_path = f"/dev/video{CAMERA_ID}"
    print(f"[INFO] Trying device path: {device_path}")
    cap = cv2.VideoCapture(device_path, backend)

    if not cap.isOpened():
        # Fallback: try device index with specified backend
        print(f"[INFO] Trying camera index {CAMERA_ID}...")
        cap = cv2.VideoCapture(CAMERA_ID, backend)
    
    if not cap.isOpened():
        # Fallback: try with CAP_ANY
        print("[INFO] Trying with CAP_ANY backend...")
        cap = cv2.VideoCapture(CAMERA_ID, cv2.CAP_ANY)
    
    if not cap.isOpened():
        print(f"[ERROR] Failed to open USB camera {CAMERA_ID}")
        return None
    
    # Apply USB camera optimizations
    _configure_usb_camera(cap)
    
    # Verify camera is working
    ok, test_frame = cap.read()
    if not ok or test_frame is None:
        cap.release()
        print("[ERROR] USB camera opened but failed to capture frame")
        return None
    
    # Report actual camera settings
    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    actual_fps = cap.get(cv2.CAP_PROP_FPS)
    actual_fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
    fourcc_str = ''.join([chr((actual_fourcc >> (8 * i)) & 0xFF) for i in range(4)])
    
    print(f"[INFO] USB camera initialized successfully")
    print(f"[INFO] Camera config:")
    print(f"       Resolution: {actual_w}x{actual_h} (requested: {CAPTURE_WIDTH}x{CAPTURE_HEIGHT})")
    print(f"       FPS: {actual_fps:.1f} (requested: {CAMERA_FPS})")
    print(f"       Codec: {fourcc_str}")
    print(f"       Buffer size: {USB_CAMERA_BUFFER_SIZE}")
    print(f"       Backend: {backend_name}")
    
    return CaptureAdapter(read=cap.read, release=cap.release)


def _open_picamera2() -> CaptureAdapter | None:
    """
    Open a CSI ribbon camera via Picamera2.
    
    This is the fallback for Raspberry Pi CSI cameras when
    USB camera mode is disabled or fails.
    
    Returns:
        CaptureAdapter if successful, None otherwise
    """
    try:
        from picamera2 import Picamera2
    except Exception:
        try:
            import sys
            if '/usr/lib/python3/dist-packages' not in sys.path:
                sys.path.append('/usr/lib/python3/dist-packages')
            from picamera2 import Picamera2
        except Exception:
            print("[ERROR] Picamera2 not available")
            return None

    try:
        # Check global_camera_info *before* instantiating Picamera2 so we
        # don't lock a USB webcam that libcamera happens to enumerate.
        cam_list = Picamera2.global_camera_info()
        if CAMERA_ID < len(cam_list):
            cam_info = cam_list[CAMERA_ID]
            cam_hw_id = cam_info.get('Id', '')
            cam_model = cam_info.get('Model', '')
            # libcamera's UVC pipeline handler puts '/usb' in the Id path
            if '/usb' in cam_hw_id or 'uvcvideo' in cam_hw_id:
                print(f"[INFO] Picamera2 camera {CAMERA_ID} is a USB/UVC device "
                      f"('{cam_model}'), skipping — use OpenCV USB path instead")
                return None
        else:
            print(f"[INFO] No Picamera2 camera at index {CAMERA_ID}")
            return None

        picam = Picamera2(CAMERA_ID)
        preview_kwargs = {
            "main": {"size": (CAPTURE_WIDTH, CAPTURE_HEIGHT), "format": "BGR888"}
        }

        controls = {}

        # Lock frame duration for consistent FPS
        if CAMERA_FORCE_FPS_LOCK:
            frame_duration_us = int(1_000_000 / max(1, CAMERA_FPS))
            controls["FrameDurationLimits"] = (frame_duration_us, frame_duration_us)

        # Anti-flicker: lock exposure to a multiple of the mains period
        if CSI_FIXED_EXPOSURE_US > 0:
            controls["ExposureTime"] = CSI_FIXED_EXPOSURE_US
            controls["AeEnable"] = False  # disable auto-exposure
            print(f"[INFO] CSI exposure locked to {CSI_FIXED_EXPOSURE_US} µs (anti-flicker)")

        # Analogue gain range
        if CSI_ANALOGUE_GAIN_MIN > 0 and CSI_ANALOGUE_GAIN_MAX > 0:
            controls["AnalogueGain"] = CSI_ANALOGUE_GAIN_MAX

        # Colour saturation
        controls["Saturation"] = CSI_SATURATION

        # ── Colour / White-Balance ──────────────────────────────────────
        use_manual_gains = CSI_RED_GAIN > 0 and CSI_BLUE_GAIN > 0

        if use_manual_gains:
            # Fixed colour gains — bypass AWB entirely
            controls["AwbEnable"] = False
            controls["ColourGains"] = (CSI_RED_GAIN, CSI_BLUE_GAIN)
            print(f"[INFO] Manual colour gains: red={CSI_RED_GAIN}, blue={CSI_BLUE_GAIN}")
        else:
            # Auto white-balance mode
            awb_map = {
                'auto': 0, 'incandescent': 1, 'tungsten': 2,
                'fluorescent': 3, 'indoor': 4, 'daylight': 5,
                'cloudy': 6, 'custom': 7,
            }
            if CSI_AWB_MODE in awb_map:
                controls["AwbMode"] = awb_map[CSI_AWB_MODE]

        if controls:
            preview_kwargs["controls"] = controls

        preview_config = picam.create_preview_configuration(**preview_kwargs)
        picam.configure(preview_config)

        picam.start()

        # ── AWB lock-after-convergence ──────────────────────────────────
        # Let AWB auto-adjust for a few seconds, then freeze the gains
        # so colours stay stable during operation.
        if not use_manual_gains and CSI_AWB_LOCK:
            delay = CSI_AWB_LOCK_DELAY
            print(f"[INFO] Waiting {delay:.1f}s for AWB to converge before locking...")
            time.sleep(delay)
            meta = picam.capture_metadata()
            locked_gains = meta.get("ColourGains")
            if locked_gains:
                picam.set_controls({
                    "AwbEnable": False,
                    "ColourGains": locked_gains,
                })
                print(f"[INFO] AWB locked: red={locked_gains[0]:.3f}, blue={locked_gains[1]:.3f}, "
                      f"CT={meta.get('ColourTemperature', '?')}K")
            else:
                print("[WARN] Could not read AWB gains; AWB remains unlocked")
        else:
            time.sleep(0.15)

        def read_from_picam():
            frame_bgr = picam.capture_array()
            return True, frame_bgr

        def release_picam():
            try:
                picam.stop()
            except Exception:
                pass

        print(f"[INFO] Camera backend: Picamera2 index {CAMERA_ID}")
        print(
            "[INFO] Camera config:",
            {
                "size": [CAPTURE_WIDTH, CAPTURE_HEIGHT],
                "camera_fps_target": CAMERA_FPS,
                "camera_force_fps_lock": CAMERA_FORCE_FPS_LOCK,
                "processing_fps_target": FPS_TARGET,
                "frame_rotate": FRAME_ROTATE,
                "line_position_percent": LINE_POSITION_PERCENT,
                "preview_scale": PREVIEW_SCALE,
                "preview_max_width": PREVIEW_MAX_WIDTH,
                "preview_max_height": PREVIEW_MAX_HEIGHT,
                "csi_saturation": CSI_SATURATION,
                "csi_awb_lock": CSI_AWB_LOCK,
                "manual_colour_gains": use_manual_gains,
            },
        )
        return CaptureAdapter(read=read_from_picam, release=release_picam)
    except Exception as exc:
        print(f"[ERROR] Failed to initialize Picamera2: {exc}")
        try:
            picam.close()
        except Exception:
            pass
        return None


def open_capture() -> CaptureAdapter | None:
    """
    Open the camera for video capture with auto-detection.
    
    Strategy (USB_CAMERA_MODE='auto' or unset):
      1. Try CSI camera via Picamera2 first
      2. If no CSI camera, try USB camera with optimizations
    
    Explicit overrides via USB_CAMERA_MODE:
      'true'  → force USB camera path (skip CSI detection)
      'false' → force Picamera2/CSI path (skip USB detection)
      'auto'  → auto-detect: try CSI first, then USB
    
    Returns:
        CaptureAdapter if successful, None otherwise
    """
    mode = os.environ.get('USB_CAMERA_MODE', 'auto').strip().lower()
    force_usb = mode in ('1', 'true', 'yes', 'on')
    force_csi = mode in ('0', 'false', 'no', 'off')
    # anything else (including 'auto') → auto-detect

    if force_usb:
        print("[INFO] USB_CAMERA_MODE=true → using USB camera path")
        adapter = _open_usb_camera()
        if adapter is not None:
            return adapter
        print("[INFO] USB camera failed, trying Picamera2 fallback...")
        return _open_picamera2()

    if force_csi:
        print("[INFO] USB_CAMERA_MODE=false → using Picamera2/CSI path")
        return _open_picamera2()

    # Auto-detect: try CSI (Picamera2) first, then USB
    print("[INFO] Auto-detecting camera (CSI first, then USB)...")
    adapter = _open_picamera2()
    if adapter is not None:
        return adapter

    print("[INFO] No CSI camera found, trying USB camera...")
    return _open_usb_camera()


def load_environment() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass


def build_request_payload(count: int, class_counts: dict = None):
    device_id = os.environ.get('DEVICE_ID')
    payload = {'count': count}
    if device_id:
        payload['device_id'] = device_id
    if class_counts:
        payload['class_counts'] = {k: v for k, v in class_counts.items() if v > 0}
    return payload


def post_count_with_urllib(count: int) -> None:
    ingest_url = os.environ.get('INGEST_URL', INGEST_URL)
    token = os.environ.get('DEVICE_TOKEN')
    payload = build_request_payload(count)
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        req = urllib.request.Request(
            ingest_url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        try:
            fallback_req = urllib.request.Request(
                LEGACY_UPDATE_COUNT_URL,
                data=json.dumps({'count': count}).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
            )
            urllib.request.urlopen(fallback_req, timeout=1)
        except Exception as exc:
            print(f"[WARN] Failed to post count (urllib): {exc}")


def build_post_count_handler():
    try:
        import requests
    except Exception:
        return post_count_with_urllib

    def post_count_with_requests(count: int) -> None:
        ingest_url = os.environ.get('INGEST_URL', INGEST_URL)
        token = os.environ.get('DEVICE_TOKEN')
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        payload = build_request_payload(count)

        try:
            response = requests.post(ingest_url, json=payload, headers=headers, timeout=2)
            if not (200 <= getattr(response, 'status_code', 0) < 300):
                requests.post(LEGACY_UPDATE_COUNT_URL, json={'count': count}, timeout=1)
        except Exception:
            try:
                requests.post(LEGACY_UPDATE_COUNT_URL, json={'count': count}, timeout=1)
            except Exception as exc:
                print(f"[WARN] Failed to post count: {exc}")

    return post_count_with_requests


def load_model() -> YOLO:
    primary_path = MODEL_PATH
    fallback_path = MODEL_FALLBACK_PATH

    if os.path.exists(primary_path):
        try:
            # Pass task='detect' explicitly for ONNX models to avoid
            # the "Unable to automatically guess model task" warning.
            model = YOLO(primary_path, task='detect')
            print(f"[INFO] Loaded model: {primary_path}")
            return model
        except Exception as exc:
            print(f"[WARN] Failed to load primary model '{primary_path}': {exc}")
    else:
        print(f"[WARN] Primary model not found: {primary_path}")

    if os.path.exists(fallback_path):
        try:
            model = YOLO(fallback_path, task='detect')
            print(f"[INFO] Loaded fallback model: {fallback_path}")
            return model
        except Exception as exc:
            raise RuntimeError(f"Failed to load fallback model '{fallback_path}': {exc}") from exc

    raise FileNotFoundError(
        f"No valid model file found. Checked MODEL_PATH='{primary_path}' and MODEL_FALLBACK_PATH='{fallback_path}'."
    )


def get_onnx_input_size(model: YOLO) -> Optional[int]:
    """
    Query an ONNX model's fixed input dimensions.

    Returns the expected square input size if the loaded model is ONNX
    with fixed (non-dynamic) spatial dims, otherwise None.
    """
    try:
        session = getattr(model.predictor.model, 'session', None) if model.predictor else None
        if session is None:
            # Model hasn't run yet; check via onnxruntime directly
            model_path = model.ckpt_path if hasattr(model, 'ckpt_path') else None
            if model_path and str(model_path).endswith('.onnx'):
                import onnxruntime as ort
                sess = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
                shape = sess.get_inputs()[0].shape  # e.g. [1, 3, 480, 480]
                if len(shape) == 4 and isinstance(shape[2], int) and isinstance(shape[3], int):
                    if shape[2] == shape[3]:
                        return shape[2]
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Visualization Helpers
# ─────────────────────────────────────────────────────────────────────────────

def draw_counting_zones(
    frame: np.ndarray,
    line_y: int,
    hysteresis: int,
    frame_w: int,
) -> None:
    """
    Draw the counting line and hysteresis zone boundaries on the frame.
    
    Visualization:
    - Solid blue line: main counting line
    - Dashed cyan lines: hysteresis zone boundaries
    
    Args:
        frame: Frame to draw on (modified in place)
        line_y: Y-coordinate of counting line
        hysteresis: Width of hysteresis band
        frame_w: Frame width
    """
    upper = max(0, line_y - hysteresis // 2)
    lower = min(frame.shape[0] - 1, line_y + hysteresis // 2)
    
    # Draw semi-transparent hysteresis band
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, upper), (frame_w, lower), COLOR_LINE_ZONE, -1)
    cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)
    
    # Draw main counting line (solid, thick, bright red)
    cv2.line(frame, (0, line_y), (frame_w, line_y), (0, 0, 255), 3)
    
    # Draw hysteresis boundaries (thin dashed-style lines)
    cv2.line(frame, (0, upper), (frame_w, upper), COLOR_LINE_ZONE, 1)
    cv2.line(frame, (0, lower), (frame_w, lower), COLOR_LINE_ZONE, 1)


def draw_tracked_object(
    frame: np.ndarray,
    obj: TrackedObject,
    roi_offset_y: int,
    is_recently_counted: bool = False,
) -> None:
    """
    Draw bounding box, centroid, and track ID for a tracked object.
    
    Args:
        frame: Frame to draw on
        obj: TrackedObject to visualize
        roi_offset_y: Y offset to account for ROI extraction
        is_recently_counted: If True, use highlight color
    """
    x1, y1, x2, y2 = obj.bbox
    y1 += roi_offset_y
    y2 += roi_offset_y
    
    # Choose color based on count status or class
    if is_recently_counted:
        box_color = COLOR_BOX_COUNTED
    elif obj.class_id < len(CLASS_COLORS_BGR):
        box_color = CLASS_COLORS_BGR[obj.class_id]
    else:
        box_color = COLOR_BOX
    
    # Draw bounding box with class label
    cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
    cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else '?'
    label = f"{cls_name} {obj.confidence:.2f}"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
    cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 2, y1), box_color, -1)
    cv2.putText(frame, label, (x1 + 1, y1 - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)


def draw_stats_overlay(
    frame: np.ndarray,
    counter: int,
    fps: float,
    active_tracks: int,
    class_counts: dict = None,
) -> None:
    """
    Draw statistics overlay on the frame.
    
    Args:
        frame: Frame to draw on
        counter: Current fish count
        fps: Current processing FPS
        active_tracks: Number of active tracks
        class_counts: Per-class count dictionary
    """
    cv2.putText(frame, f"Count: {counter}", (10, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, COLOR_COUNTER, 2)
    y_off = 70
    if class_counts:
        for i, name in enumerate(CLASS_NAMES):
            c = class_counts.get(name, 0)
            color = CLASS_COLORS_BGR[i] if i < len(CLASS_COLORS_BGR) else (255, 255, 255)
            cv2.putText(frame, f"  {name}: {c}", (10, y_off),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)
            y_off += 22
    cv2.putText(frame, f"FPS: {fps:.1f}", (10, y_off),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    cv2.putText(frame, f"Tracks: {active_tracks}", (10, y_off + 25),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)


# ─────────────────────────────────────────────────────────────────────────────
# Model Warmup (Performance Optimization)
# ─────────────────────────────────────────────────────────────────────────────

def warmup_model(model: YOLO, device: str, input_size: int) -> None:
    """
    Warm up the model with dummy inference passes.
    
    This ensures:
    - CUDA kernels are compiled (if using GPU)
    - Memory is allocated
    - First actual inference is not slow
    
    Critical for consistent real-time performance on RPi5.
    
    Args:
        model: Loaded YOLO model
        device: 'cuda' or 'cpu'
        input_size: Model input size
    """
    print(f"[INFO] Warming up model ({WARMUP_FRAMES} iterations)...")
    dummy_frame = np.zeros((input_size, input_size, 3), dtype=np.uint8)
    
    for i in range(WARMUP_FRAMES):
        _ = model.predict(
            dummy_frame,
            conf=CONFIDENCE_THRESHOLD,
            imgsz=input_size,
            device=device,
            verbose=False,
        )
    
    print("[INFO] Model warmup complete")


# ─────────────────────────────────────────────────────────────────────────────
# Main Counter Logic
# ─────────────────────────────────────────────────────────────────────────────

def run_counter(post_count) -> None:
    """
    Main fish counting loop with optimized detection and tracking.
    
    Pipeline Overview:
    -----------------
    1. Capture frame from camera
    2. Apply rotation and color correction
    3. Extract ROI (Region of Interest) around counting line
    4. Run YOLO detection (with optional frame skipping)
    5. Update centroid tracker with detections
    6. Check for line crossings and count fish
    7. Visualize results and send count updates
    
    Performance Optimizations:
    -------------------------
    - ROI extraction: Only process area near counting line
    - Frame skipping: Process every Nth frame for detection
    - Model warmup: Pre-load CUDA kernels and allocate memory
    - Efficient tracker: NumPy-vectorized centroid matching
    - Adaptive skip: Adjust frame skip based on detection activity
    
    Counting Logic:
    --------------
    Fish are counted when:
    1. Track crosses from TOP zone to BOTTOM zone
    2. Track has existed for MIN_TRACK_AGE_FOR_COUNT frames
    3. At least MIN_CROSSING_FRAMES since last count for this track
    4. Track passes consistency checks (stable box size, confidence)
    """
    global INPUT_SIZE

    print("=" * 60)
    print("  FISH COUNTER - Optimized for Raspberry Pi 5")
    print("=" * 60)

    # ─────────────────────────────────────────────────────────────────────────
    # Device Selection
    # ─────────────────────────────────────────────────────────────────────────
    gpu_available = torch.cuda.is_available()
    device = "cuda" if (USE_GPU and gpu_available) else "cpu"
    print(f"[INFO] Device: {device.upper()}")
    print(f"[INFO] Input size: {INPUT_SIZE}x{INPUT_SIZE}")
    print(f"[INFO] Frame skip: {FRAME_SKIP}")
    print(f"[INFO] Confidence threshold: {CONFIDENCE_THRESHOLD}")
    print(f"[INFO] Counting direction: {COUNTING_DIRECTION}")

    # ─────────────────────────────────────────────────────────────────────────
    # Load Model and Initialize Camera
    # ─────────────────────────────────────────────────────────────────────────
    model = load_model()

    # Validate INPUT_SIZE against ONNX model's fixed dimensions
    onnx_size = get_onnx_input_size(model)
    if onnx_size is not None and onnx_size != INPUT_SIZE:
        print(f"[WARN] ONNX model expects {onnx_size}x{onnx_size} input, "
              f"but INPUT_SIZE={INPUT_SIZE}. Overriding to {onnx_size}.")
        INPUT_SIZE = onnx_size

    capture = open_capture()
    if capture is None:
        print("[ERROR] Failed to initialize camera")
        return

    # Warmup model for consistent performance
    warmup_model(model, device, INPUT_SIZE)

    # ─────────────────────────────────────────────────────────────────────────
    # Initialize Tracker
    # ─────────────────────────────────────────────────────────────────────────
    if USE_KALMAN_TRACKER:
        # SORT-style Kalman filter tracker — predicts fish positions
        # across detection gaps for better accuracy with fast-moving fish
        tracker = KalmanSortTracker(
            max_age=KALMAN_MAX_AGE,
            min_hits=KALMAN_MIN_HITS,
            iou_threshold=KALMAN_IOU_THRESHOLD,
        )
        tracker.MIN_TRACK_AGE_FOR_COUNT = MIN_TRACK_AGE_FOR_COUNT
        print(f"[INFO] Tracker: KalmanSORT (max_age={KALMAN_MAX_AGE}, "
              f"min_hits={KALMAN_MIN_HITS}, iou={KALMAN_IOU_THRESHOLD})")
    else:
        # Legacy centroid tracker with EMA smoothing
        tracker = CentroidTracker(
            max_disappeared=TRACKER_MAX_DISAPPEARED,
            max_distance=TRACKER_MAX_DISTANCE,
            ema_alpha=TRACKER_EMA_ALPHA,
        )
        tracker.MIN_TRACK_AGE_FOR_COUNT = MIN_TRACK_AGE_FOR_COUNT
        print(f"[INFO] Tracker: CentroidTracker (legacy)")

    # ─────────────────────────────────────────────────────────────────────────
    # State Variables
    # ─────────────────────────────────────────────────────────────────────────
    counter = 0                 # Total fish count
    counter_up = 0              # Fish moving up (if bidirectional)
    counter_down = 0            # Fish moving down
    class_counts = {name: 0 for name in CLASS_NAMES}  # Per-class fish count
    frame_index = 0             # Frame counter
    recently_counted_ids = {}   # {track_id: frame_when_counted} for visualization
    
    # FPS calculation
    fps_start_time = time.time()
    fps_frame_count = 0
    current_fps = 0.0
    
    # Adaptive frame skip state
    adaptive_skip = FRAME_SKIP
    last_detection_count = 0

    print("[INFO] Starting detection loop (press 'q' to quit)")
    
    # ─────────────────────────────────────────────────────────────────────────
    # Create and Center Preview Window
    # ─────────────────────────────────────────────────────────────────────────
    window_centered = False
    if SHOW_PREVIEW_WINDOW:
        cv2.namedWindow("Fish Counter", cv2.WINDOW_AUTOSIZE)
    
    print("-" * 60)

    while True:
        ret, frame = capture.read()
        if not ret:
            print("[WARN] Failed to read frame, exiting")
            break

        # ─────────────────────────────────────────────────────────────────────
        # Frame Preprocessing
        # ─────────────────────────────────────────────────────────────────────
        frame = apply_frame_rotation(frame)
        frame = apply_frame_autofix(frame)
        frame_index += 1

        frame_h, frame_w = frame.shape[:2]
        line_y = compute_line_y(frame_h)
        
        # ─────────────────────────────────────────────────────────────────────
        # ROI Extraction (Performance Optimization)
        # ─────────────────────────────────────────────────────────────────────
        # Only process the band around the counting line
        # This significantly reduces computation on RPi5
        
        roi_half = max(10, ROI_BAND_HEIGHT // 2)
        roi_top = max(0, line_y - roi_half)
        roi_bottom = min(frame_h, line_y + roi_half)
        roi_frame = frame[roi_top:roi_bottom, :]
        
        # Compute line position relative to ROI (for tracker zone updates)
        line_y_relative = line_y - roi_top

        # ─────────────────────────────────────────────────────────────────────
        # Frame Skipping (Performance Optimization)
        # ─────────────────────────────────────────────────────────────────────
        # Skip detection on some frames but still display tracking results
        
        current_skip = adaptive_skip if ADAPTIVE_FRAME_SKIP else FRAME_SKIP
        skip_detection = (current_skip > 1) and (frame_index % current_skip != 0)

        if skip_detection and USE_KALMAN_TRACKER:
            # Kalman tracker: predict positions forward even on skipped frames
            # so zone updates remain accurate and fish can be counted mid-skip
            tracker.predict_only()

        if not skip_detection:
            # ─────────────────────────────────────────────────────────────────
            # Run Detection
            # ─────────────────────────────────────────────────────────────────
            
            if USE_YOLO_TRACKER:
                # Use YOLO's built-in tracker for ID assignment
                results = model.track(
                    roi_frame,
                    persist=True,
                    conf=CONFIDENCE_THRESHOLD,
                    imgsz=INPUT_SIZE,
                    device=device,
                    iou=TRACK_IOU_THRESHOLD,
                    verbose=False,
                )[0]
                
                # Extract detections from YOLO results
                detections = []
                if results.boxes.id is not None:
                    for box, conf, track_id, cls in zip(
                        results.boxes.xyxy.cpu().numpy(),
                        results.boxes.conf.cpu().numpy(),
                        results.boxes.id.cpu().numpy(),
                        results.boxes.cls.cpu().numpy(),
                    ):
                        x1, y1, x2, y2 = map(int, box)
                        detections.append(((x1, y1, x2, y2), float(conf), int(cls)))
                elif len(results.boxes) > 0:
                    # Fallback if tracking IDs not available
                    for box, conf, cls in zip(
                        results.boxes.xyxy.cpu().numpy(),
                        results.boxes.conf.cpu().numpy(),
                        results.boxes.cls.cpu().numpy(),
                    ):
                        x1, y1, x2, y2 = map(int, box)
                        detections.append(((x1, y1, x2, y2), float(conf), int(cls)))
            else:
                # Use basic prediction without built-in tracking
                results = model.predict(
                    roi_frame,
                    conf=CONFIDENCE_THRESHOLD,
                    imgsz=INPUT_SIZE,
                    device=device,
                    verbose=False,
                )[0]
                
                detections = []
                if len(results.boxes) > 0:
                    for box, conf, cls in zip(
                        results.boxes.xyxy.cpu().numpy(),
                        results.boxes.conf.cpu().numpy(),
                        results.boxes.cls.cpu().numpy(),
                    ):
                        x1, y1, x2, y2 = map(int, box)
                        detections.append(((x1, y1, x2, y2), float(conf), int(cls)))

            # ─────────────────────────────────────────────────────────────────
            # Low-Confidence Class Filtering
            # ─────────────────────────────────────────────────────────────────
            # Detections below CLASS_CONF_THRESHOLD are unreliable for
            # classification. We keep the detection for tracking but flag
            # its class_id as -1 so the tracker can fall back to the
            # dominant class from the track's history.
            if CLASS_CONF_THRESHOLD > 0:
                filtered = []
                for bbox, conf, cls_id in detections:
                    if conf < CLASS_CONF_THRESHOLD:
                        cls_id = -1  # unreliable class — tracker will resolve
                    filtered.append((bbox, conf, cls_id))
                detections = filtered

            # ─────────────────────────────────────────────────────────────────
            # Update Tracker
            # ─────────────────────────────────────────────────────────────────
            # The tracker provides:
            # - Smooth position updates via EMA / Kalman prediction
            # - Consistent ID assignment across frames
            # - Detection flickering suppression
            # - Class stabilization from confidence history
            
            tracker.update(detections)
            last_detection_count = len(detections)
            
            # ─────────────────────────────────────────────────────────────────
            # Adaptive Frame Skip (Optional Performance Optimization)
            # ─────────────────────────────────────────────────────────────────
            # Increase skip when few detections, decrease when many
            
            if ADAPTIVE_FRAME_SKIP:
                if last_detection_count == 0:
                    adaptive_skip = min(FRAME_SKIP + 2, 6)  # Skip more when idle
                elif last_detection_count > 3:
                    adaptive_skip = max(FRAME_SKIP - 1, 1)  # Skip less when busy
                else:
                    adaptive_skip = FRAME_SKIP

        # ─────────────────────────────────────────────────────────────────────
        # Update Zones and Check Crossings
        # ─────────────────────────────────────────────────────────────────────
        # Zone update happens every frame (even skipped ones) for accuracy
        
        tracker.update_zones(line_y_relative, LINE_HYSTERESIS_PX)
        
        # Check for fish crossing the line
        # Downward crossing (top -> bottom)
        if COUNTING_DIRECTION in ('down', 'both'):
            down_crossings = tracker.get_crossing_candidates(
                frame_index,
                MIN_CROSSING_FRAMES,
                direction='down',
            )
            for obj in down_crossings:
                counter += 1
                counter_down += 1
                cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else 'Unknown'
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
                tracker.mark_counted(obj, frame_index)
                recently_counted_ids[obj.object_id] = frame_index
                
                print(f"[COUNT] {cls_name} #{counter} crossed DOWN (Track ID: {obj.object_id})")
                
                try:
                    post_count(counter)
                except Exception as exc:
                    print(f"[WARN] Failed to post count: {exc}")
        
        # Upward crossing (bottom -> top)
        if COUNTING_DIRECTION in ('up', 'both'):
            up_crossings = tracker.get_crossing_candidates(
                frame_index,
                MIN_CROSSING_FRAMES,
                direction='up',
            )
            for obj in up_crossings:
                cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else 'Unknown'
                if COUNTING_DIRECTION == 'both':
                    counter_up += 1
                else:
                    counter += 1
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
                tracker.mark_counted(obj, frame_index)
                recently_counted_ids[obj.object_id] = frame_index
                
                print(f"[COUNT] {cls_name} crossed UP (Track ID: {obj.object_id})")
                
                try:
                    post_count(counter)
                except Exception as exc:
                    print(f"[WARN] Failed to post count: {exc}")

        # ─────────────────────────────────────────────────────────────────────
        # Cleanup Old "Recently Counted" Markers
        # ─────────────────────────────────────────────────────────────────────
        stale_ids = [
            tid for tid, f in recently_counted_ids.items()
            if frame_index - f > 30  # Keep highlight for 30 frames
        ]
        for tid in stale_ids:
            recently_counted_ids.pop(tid, None)

        # ─────────────────────────────────────────────────────────────────────
        # Calculate FPS
        # ─────────────────────────────────────────────────────────────────────
        fps_frame_count += 1
        elapsed = time.time() - fps_start_time
        if elapsed >= 1.0:
            current_fps = fps_frame_count / elapsed
            fps_frame_count = 0
            fps_start_time = time.time()

        # ─────────────────────────────────────────────────────────────────────
        # Visualization
        # ─────────────────────────────────────────────────────────────────────
        
        # Draw counting zones
        draw_counting_zones(frame, line_y, LINE_HYSTERESIS_PX, frame_w)
        
        # Draw tracked objects
        active_tracks = tracker.get_active_tracks()
        for obj_id, obj in active_tracks.items():
            is_recent = obj_id in recently_counted_ids
            draw_tracked_object(frame, obj, roi_top, is_recently_counted=is_recent)
        
        # Draw statistics overlay
        draw_stats_overlay(frame, counter, current_fps, len(active_tracks), class_counts)

        # ─────────────────────────────────────────────────────────────────────
        # Display or Wait
        # ─────────────────────────────────────────────────────────────────────
        if SHOW_PREVIEW_WINDOW:
            preview = build_preview_frame(frame)
            cv2.imshow("Fish Counter", preview)
            
            # Center window on first frame (only once)
            if not window_centered:
                window_centered = True
                try:
                    # Try to get screen size and center the window
                    # Default to 800x480 for 7-inch Raspberry Pi touchscreens
                    screen_w, screen_h = 800, 480
                    try:
                        # Try xrandr to get screen dimensions
                        import subprocess
                        result = subprocess.run(
                            ['xrandr', '--query'], capture_output=True, text=True, timeout=2
                        )
                        for xr_line in result.stdout.split('\n'):
                            if ' connected ' in xr_line and 'x' in xr_line:
                                import re
                                m = re.search(r'(\d+)x(\d+)', xr_line)
                                if m:
                                    screen_w, screen_h = int(m.group(1)), int(m.group(2))
                                    break
                    except Exception:
                        pass  # Use default 800x480 (7-inch touchscreen)
                    
                    preview_h, preview_w = preview.shape[:2]
                    x = max(0, (screen_w - preview_w) // 2)
                    y = max(0, (screen_h - preview_h) // 2)
                    cv2.moveWindow("Fish Counter", x, y)
                    print(f"[INFO] Window centered at ({x}, {y})")
                except Exception:
                    pass  # Window will use default position
            
            key = cv2.waitKey(FRAME_DELAY) & 0xFF
            if key in [ord('q'), 27]:  # 'q' or ESC
                break
        else:
            # Maintain frame rate even without display
            time.sleep(FRAME_DELAY / 1000.0)

    # ─────────────────────────────────────────────────────────────────────────
    # Cleanup
    # ─────────────────────────────────────────────────────────────────────────
    capture.release()
    if SHOW_PREVIEW_WINDOW:
        cv2.destroyAllWindows()
    
    print("-" * 60)
    print(f"[DONE] Final count: {counter}")
    if COUNTING_DIRECTION == 'both':
        print(f"       Down: {counter_down}, Up: {counter_up}")
    print("=" * 60)


def main():
    load_environment()
    post_count = build_post_count_handler()
    run_counter(post_count)


if __name__ == "__main__":
    main()

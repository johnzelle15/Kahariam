#!/usr/bin/env python3
"""
Fish Detection, Tracking & Counting Pipeline
=============================================

Processes input videos with YOLOv11n detection, Kalman-SORT tracking,
and virtual-line counting. Outputs annotated videos with bounding boxes,
tracking IDs, trajectories, and live count overlays.

Usage:
    python process_videos.py

Configuration:
    Edit the CONFIG dict below, or set environment variables.

Output:
    output_black.mp4, output_pineapple.mp4, output_platinum.mp4
    tracking_log.csv  (per-frame tracking + crossing events)
"""

from __future__ import annotations

import csv
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from ultralytics import YOLO

# ── Import the existing Kalman-SORT tracker from the project ─────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from vision.kalman_tracker import KalmanSortTracker, KalmanTrack

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

CONFIG = {
    # Model
    "model_path": os.getenv("MODEL_PATH", "models/fish_detector.pt"),
    "confidence_threshold": float(os.getenv("CONFIDENCE_THRESHOLD", "0.50")),
    "input_size": int(os.getenv("INPUT_SIZE", "480")),

    # Classification filtering — detections below this confidence get
    # class_id = -1 (unreliable label); the tracker will use majority
    # vote from history instead.  Set to 0 to disable.
    "class_conf_threshold": float(os.getenv("CLASS_CONF_THRESHOLD", "0.55")),

    # Tracker (Kalman-SORT)
    "max_age": int(os.getenv("KALMAN_MAX_AGE", "20")),
    "min_hits": int(os.getenv("KALMAN_MIN_HITS", "3")),
    "iou_threshold": float(os.getenv("KALMAN_IOU_THRESHOLD", "0.20")),

    # Counting line
    "line_position": float(os.getenv("LINE_POSITION", "0.85")),  # 0.0–1.0 fraction
    "line_orientation": os.getenv("LINE_ORIENTATION", "horizontal"),  # horizontal | vertical
    "line_hysteresis_px": int(os.getenv("LINE_HYSTERESIS_PX", "60")),
    "count_direction": os.getenv("COUNT_DIRECTION", "both"),  # down | up | both
    "min_crossing_frames": int(os.getenv("MIN_CROSSING_FRAMES", "12")),

    # Visualization
    "trail_length": int(os.getenv("TRAIL_LENGTH", "30")),
    "show_fps": True,

    # I/O
    "input_dir": os.getenv("INPUT_DIR", "evaluation/videos"),
    "output_dir": os.getenv("OUTPUT_DIR", "."),
    "csv_output": os.getenv("CSV_OUTPUT", "tracking_log.csv"),
}

# Class names from the trained model (alphabetical order)
CLASS_NAMES = {0: "Black", 1: "Pineapple", 2: "Platinum"}
CLASS_COLORS = {
    0: (50, 50, 50),       # Black fish → dark gray
    1: (0, 200, 255),      # Pineapple → orange-yellow
    2: (230, 230, 230),    # Platinum → silver-white
}

# ─────────────────────────────────────────────────────────────────────────────
# Detection Module
# ─────────────────────────────────────────────────────────────────────────────

class FishDetector:
    """Wraps YOLO model for fish detection."""

    def __init__(self, model_path: str, conf_threshold: float = 0.5,
                 input_size: int = 480):
        self.model = YOLO(model_path)
        self.conf_threshold = conf_threshold
        self.input_size = input_size

    def detect(self, frame: np.ndarray) -> List[Tuple[Tuple[int,int,int,int], float, int]]:
        """
        Run detection on a single frame.

        Returns list of ((x1, y1, x2, y2), confidence, class_id).
        """
        results = self.model.predict(
            frame,
            imgsz=self.input_size,
            conf=self.conf_threshold,
            verbose=False,
        )

        detections = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                detections.append(((x1, y1, x2, y2), conf, cls_id))

        return detections


# ─────────────────────────────────────────────────────────────────────────────
# Counting Module
# ─────────────────────────────────────────────────────────────────────────────

class LineCrossingCounter:
    """
    Counts fish that cross a virtual line.

    Only counts when:
    - The fish centroid crosses the line in the configured direction
    - The fish has a consistent track (confirmed by the tracker)
    - The fish has NOT been counted before (ID-based dedup)
    - Anti-jitter: requires the fish to be on one side, then the other
      (hysteresis band prevents double-counting from oscillation)
    """

    def __init__(self, line_pos: float, orientation: str, hysteresis: int,
                 direction: str, min_crossing_frames: int):
        self.line_pos = line_pos            # 0.0–1.0 fraction
        self.orientation = orientation      # 'horizontal' or 'vertical'
        self.hysteresis = hysteresis
        self.direction = direction          # 'down', 'up', or 'both'
        self.min_crossing_frames = min_crossing_frames

        self.counted_ids: set = set()       # Track IDs already counted
        self.total_count: int = 0
        self.crossing_events: list = []     # (frame_num, track_id, class_id, direction)

        # Per-track zone memory: {track_id: last_known_zone}
        self._zones: Dict[int, str] = {}
        self._last_zones: Dict[int, str] = {}
        self._last_count_frame: Dict[int, int] = {}

    def get_line_pixel(self, frame_shape: Tuple[int, ...]) -> int:
        """Get the line position in pixels given frame dimensions."""
        if self.orientation == "horizontal":
            return int(frame_shape[0] * self.line_pos)  # y coordinate
        else:
            return int(frame_shape[1] * self.line_pos)  # x coordinate

    def update(self, tracks: Dict[int, object], frame_num: int,
               frame_shape: Tuple[int, ...]) -> List[Tuple[int, int]]:
        """
        Check all active tracks for line crossings.

        Returns list of (track_id, class_id) for newly counted fish.
        """
        line_px = self.get_line_pixel(frame_shape)
        half_hyst = self.hysteresis // 2
        newly_counted = []

        for tid, track in tracks.items():
            cx, cy = track.centroid

            # Determine which coordinate matters
            pos = cy if self.orientation == "horizontal" else cx

            # Classify zone relative to line
            if pos < line_px - half_hyst:
                zone = "before"  # above (horiz) or left (vert)
            elif pos > line_px + half_hyst:
                zone = "after"   # below (horiz) or right (vert)
            else:
                zone = "middle"

            prev_zone = self._zones.get(tid, "unknown")

            # Only update zone memory for definitive zones (not middle)
            if zone != "middle":
                self._last_zones[tid] = self._zones.get(tid, zone)
                self._zones[tid] = zone
            else:
                # In hysteresis band — don't change zone assignment
                if tid not in self._zones:
                    self._zones[tid] = zone

            # Check for crossing
            if tid in self.counted_ids:
                continue  # already counted

            last_zone = self._last_zones.get(tid, "unknown")
            current_zone = self._zones.get(tid, "unknown")

            # Require transition through the hysteresis band
            crossed = False
            cross_dir = None

            if last_zone == "before" and current_zone == "after":
                crossed = True
                cross_dir = "down" if self.orientation == "horizontal" else "right"
            elif last_zone == "after" and current_zone == "before":
                crossed = True
                cross_dir = "up" if self.orientation == "horizontal" else "left"

            if not crossed:
                continue

            # Direction filter
            if self.direction == "down" and cross_dir not in ("down", "right"):
                continue
            elif self.direction == "up" and cross_dir not in ("up", "left"):
                continue
            # 'both' accepts any direction

            # Minimum frames between counts for same ID (anti-jitter)
            last_cf = self._last_count_frame.get(tid, -100000)
            if frame_num - last_cf < self.min_crossing_frames:
                continue

            # Require confirmed track (enough age)
            if hasattr(track, 'age') and track.age < 3:
                continue

            # COUNT IT
            self.counted_ids.add(tid)
            self.total_count += 1
            self._last_count_frame[tid] = frame_num
            class_id = track.class_id if hasattr(track, 'class_id') else 0
            self.crossing_events.append((frame_num, tid, class_id, cross_dir))
            newly_counted.append((tid, class_id))

        return newly_counted


# ─────────────────────────────────────────────────────────────────────────────
# Visualization Module
# ─────────────────────────────────────────────────────────────────────────────

class Visualizer:
    """Draws overlays on video frames."""

    def __init__(self, trail_length: int = 30, show_fps: bool = True):
        self.trail_length = trail_length
        self.show_fps = show_fps
        # {track_id: [(cx, cy), ...]} trajectory history
        self.trajectories: Dict[int, list] = defaultdict(list)

    def update_trajectory(self, track_id: int, centroid: Tuple[float, float]):
        """Record centroid for trail drawing."""
        traj = self.trajectories[track_id]
        traj.append((int(centroid[0]), int(centroid[1])))
        if len(traj) > self.trail_length:
            traj.pop(0)

    def draw(self, frame: np.ndarray, tracks: Dict[int, object],
             counter: LineCrossingCounter, frame_num: int,
             fps: float, newly_counted: List[Tuple[int, int]]) -> np.ndarray:
        """Draw all overlays on the frame."""
        h, w = frame.shape[:2]
        overlay = frame.copy()

        # ── Draw counting line ───────────────────────────────────────────
        line_px = counter.get_line_pixel(frame.shape)
        line_color = (0, 255, 255)  # cyan

        if counter.orientation == "horizontal":
            cv2.line(overlay, (0, line_px), (w, line_px), line_color, 2)
            # Draw hysteresis band (semi-transparent)
            band_overlay = overlay.copy()
            half_h = counter.hysteresis // 2
            cv2.rectangle(band_overlay, (0, line_px - half_h),
                          (w, line_px + half_h), line_color, -1)
            cv2.addWeighted(band_overlay, 0.1, overlay, 0.9, 0, overlay)
        else:
            cv2.line(overlay, (line_px, 0), (line_px, h), line_color, 2)
            band_overlay = overlay.copy()
            half_h = counter.hysteresis // 2
            cv2.rectangle(band_overlay, (line_px - half_h, 0),
                          (line_px + half_h, h), line_color, -1)
            cv2.addWeighted(band_overlay, 0.1, overlay, 0.9, 0, overlay)

        # ── Draw tracks ──────────────────────────────────────────────────
        for tid, track in tracks.items():
            cx, cy = track.centroid
            x1, y1, x2, y2 = track.bbox

            # Determine color from class
            cls_id = track.class_id if hasattr(track, 'class_id') else 0
            color = CLASS_COLORS.get(cls_id, (0, 255, 0))

            # Highlight counted fish differently
            is_counted = tid in counter.counted_ids
            border_thickness = 3 if is_counted else 2

            # Bounding box
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, border_thickness)

            # Label: "Fish #ID (Class) conf"
            class_name = CLASS_NAMES.get(cls_id, "Fish")
            conf = track.confidence if hasattr(track, 'confidence') else 0
            label = f"#{tid} {class_name} {conf:.2f}"
            if is_counted:
                label += " [COUNTED]"

            # Label background
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(overlay, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
            text_color = (0, 0, 0) if sum(color) > 400 else (255, 255, 255)
            cv2.putText(overlay, label, (x1 + 2, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, text_color, 1, cv2.LINE_AA)

            # Centroid dot
            cv2.circle(overlay, (int(cx), int(cy)), 4, color, -1)

            # Trajectory trail
            self.update_trajectory(tid, (cx, cy))
            traj = self.trajectories[tid]
            for i in range(1, len(traj)):
                alpha = i / len(traj)
                thickness = max(1, int(alpha * 3))
                pt_color = tuple(int(c * alpha) for c in color)
                cv2.line(overlay, traj[i - 1], traj[i], pt_color, thickness)

        # ── Flash effect for newly counted fish ──────────────────────────
        for tid, cls_id in newly_counted:
            if tid in tracks:
                track = tracks[tid]
                x1, y1, x2, y2 = track.bbox
                cv2.rectangle(overlay, (x1 - 3, y1 - 3), (x2 + 3, y2 + 3),
                              (0, 255, 0), 4)

        # ── HUD overlay ──────────────────────────────────────────────────
        self._draw_hud(overlay, counter, frame_num, fps, tracks, w, h)

        return overlay

    def _draw_hud(self, frame: np.ndarray, counter: LineCrossingCounter,
                  frame_num: int, fps: float, tracks: Dict[int, object],
                  w: int, h: int):
        """Draw heads-up display with stats."""
        # Background panel
        panel_h = 120
        panel = frame[0:panel_h, 0:w].copy()
        cv2.rectangle(frame, (0, 0), (w, panel_h), (0, 0, 0), -1)
        cv2.addWeighted(panel, 0.3, frame[0:panel_h, 0:w], 0.7, 0,
                        frame[0:panel_h, 0:w])

        y_off = 22
        font = cv2.FONT_HERSHEY_SIMPLEX
        small = 0.5
        big = 0.8

        # Total count (large)
        count_text = f"Count: {counter.total_count}"
        cv2.putText(frame, count_text, (10, y_off + 5), font, big,
                    (0, 255, 0), 2, cv2.LINE_AA)

        # Frame number
        cv2.putText(frame, f"Frame: {frame_num}", (w - 180, y_off),
                    font, small, (200, 200, 200), 1, cv2.LINE_AA)

        # FPS
        if self.show_fps:
            cv2.putText(frame, f"FPS: {fps:.1f}", (w - 180, y_off + 22),
                        font, small, (200, 200, 200), 1, cv2.LINE_AA)

        # Active tracks
        active_ids = sorted(tracks.keys())
        id_str = f"Active IDs: {active_ids}" if len(active_ids) <= 15 else \
                 f"Active IDs: {active_ids[:15]}... ({len(active_ids)} total)"
        cv2.putText(frame, id_str, (10, y_off + 40), font, 0.4,
                    (180, 180, 180), 1, cv2.LINE_AA)

        # Counted IDs
        counted = sorted(counter.counted_ids)
        c_str = f"Crossed IDs: {counted}" if len(counted) <= 15 else \
                f"Crossed IDs: {counted[:15]}... ({len(counted)} total)"
        cv2.putText(frame, c_str, (10, y_off + 60), font, 0.4,
                    (0, 200, 255), 1, cv2.LINE_AA)

        # Direction indicator
        dir_text = f"Direction: {counter.direction} | Line: {counter.orientation} @ {counter.line_pos:.0%}"
        cv2.putText(frame, dir_text, (10, y_off + 80), font, 0.4,
                    (150, 150, 150), 1, cv2.LINE_AA)


# ─────────────────────────────────────────────────────────────────────────────
# CSV Logger
# ─────────────────────────────────────────────────────────────────────────────

class CSVLogger:
    """Logs tracking data and crossing events to CSV."""

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.rows: list = []

    def log_frame(self, video_name: str, frame_num: int,
                  tracks: Dict[int, object], newly_counted: List[Tuple[int, int]],
                  total_count: int):
        """Log one frame's data."""
        counted_set = {tid for tid, _ in newly_counted}
        for tid, track in tracks.items():
            cx, cy = track.centroid
            cls_id = track.class_id if hasattr(track, 'class_id') else 0
            self.rows.append({
                "video": video_name,
                "frame": frame_num,
                "track_id": tid,
                "class_id": cls_id,
                "class_name": CLASS_NAMES.get(cls_id, "Unknown"),
                "cx": round(cx, 1),
                "cy": round(cy, 1),
                "crossing_event": tid in counted_set,
                "total_count": total_count,
            })

    def save(self):
        """Write all accumulated rows to disk."""
        if not self.rows:
            return
        fieldnames = list(self.rows[0].keys())
        with open(self.filepath, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(self.rows)
        print(f"  CSV log saved: {self.filepath} ({len(self.rows)} rows)")


# ─────────────────────────────────────────────────────────────────────────────
# Main Pipeline
# ─────────────────────────────────────────────────────────────────────────────

def process_video(video_path: str, output_path: str, detector: FishDetector,
                  config: dict, csv_logger: CSVLogger) -> int:
    """
    Process a single video file through the full pipeline.

    Returns the total fish count.
    """
    video_name = Path(video_path).stem
    print(f"\n{'='*60}")
    print(f"Processing: {video_path}")
    print(f"Output:     {output_path}")
    print(f"{'='*60}")

    # Open input video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ERROR: Cannot open {video_path}")
        return 0

    fps_in = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"  Input: {w}x{h} @ {fps_in:.1f} fps, {total_frames} frames")

    # Line orientation: always horizontal as requested
    # Line at 85% of frame height = near the bottom
    line_orientation = "horizontal"
    print(f"  Line orientation: {line_orientation} @ {config['line_position']:.0%} height")

    # Open output video
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps_in, (w, h))
    if not writer.isOpened():
        print(f"  ERROR: Cannot create output writer for {output_path}")
        cap.release()
        return 0

    # Initialize tracker and counter per video
    tracker = KalmanSortTracker(
        max_age=config["max_age"],
        min_hits=config["min_hits"],
        iou_threshold=config["iou_threshold"],
    )

    counter = LineCrossingCounter(
        line_pos=config["line_position"],
        orientation=line_orientation,
        hysteresis=config["line_hysteresis_px"],
        direction=config["count_direction"],
        min_crossing_frames=config["min_crossing_frames"],
    )

    visualizer = Visualizer(
        trail_length=config["trail_length"],
        show_fps=config["show_fps"],
    )

    # Reset Kalman track ID counter for each video
    KalmanTrack._count = 0

    frame_num = 0
    fps_timer = time.time()
    fps_display = 0.0
    fps_frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_num += 1
        fps_frame_count += 1

        # ── 1. Detect ────────────────────────────────────────────────────
        detections = detector.detect(frame)

        # ── 1b. Low-confidence class filtering ───────────────────────────
        cls_thresh = config.get("class_conf_threshold", 0)
        if cls_thresh > 0:
            detections = [
                (bbox, conf, cls_id if conf >= cls_thresh else -1)
                for bbox, conf, cls_id in detections
            ]

        # ── 2. Track ─────────────────────────────────────────────────────
        tracks = tracker.update(detections)

        # ── 3. Count crossings (only actively-detected tracks) ─────────
        active_tracks = {tid: t for tid, t in tracks.items()
                         if t.disappeared == 0}
        newly_counted = counter.update(active_tracks, frame_num, frame.shape)

        # ── 4. Compute FPS ───────────────────────────────────────────────
        now = time.time()
        elapsed = now - fps_timer
        if elapsed >= 1.0:
            fps_display = fps_frame_count / elapsed
            fps_timer = now
            fps_frame_count = 0

        # ── 5. Visualize ─────────────────────────────────────────────────
        annotated = visualizer.draw(frame, tracks, counter, frame_num,
                                    fps_display, newly_counted)

        writer.write(annotated)

        # ── 6. Log ───────────────────────────────────────────────────────
        csv_logger.log_frame(video_name, frame_num, tracks,
                             newly_counted, counter.total_count)

        # ── 7. Progress ──────────────────────────────────────────────────
        if frame_num % 50 == 0 or frame_num == total_frames:
            pct = frame_num / max(total_frames, 1) * 100
            print(f"  Frame {frame_num}/{total_frames} ({pct:.0f}%) | "
                  f"Active: {len(tracks)} | Count: {counter.total_count}")

        # Log crossing events
        for tid, cls_id in newly_counted:
            class_name = CLASS_NAMES.get(cls_id, "Unknown")
            print(f"  >>> COUNTED: Fish #{tid} ({class_name}) "
                  f"crossed line at frame {frame_num}")

    cap.release()
    writer.release()

    # Final summary
    print(f"\n  ── Summary for {video_name} ──")
    print(f"  Total frames processed: {frame_num}")
    print(f"  Total fish counted:     {counter.total_count}")
    print(f"  Unique IDs tracked:     {KalmanTrack._count}")
    print(f"  Counted IDs:            {sorted(counter.counted_ids)}")
    if counter.crossing_events:
        print(f"  Crossing events:")
        for evt_frame, evt_id, evt_cls, evt_dir in counter.crossing_events:
            print(f"    Frame {evt_frame}: Fish #{evt_id} "
                  f"({CLASS_NAMES.get(evt_cls, '?')}) → {evt_dir}")

    return counter.total_count


def main():
    """Process all three videos."""
    print("Fish Detection, Tracking & Counting Pipeline")
    print("=" * 60)
    print(f"Model:       {CONFIG['model_path']}")
    print(f"Confidence:  {CONFIG['confidence_threshold']}")
    print(f"Line:        {CONFIG['line_orientation']} @ {CONFIG['line_position']:.0%}")
    print(f"Direction:   {CONFIG['count_direction']}")
    print(f"Tracker:     Kalman-SORT (max_age={CONFIG['max_age']}, "
          f"min_hits={CONFIG['min_hits']}, iou={CONFIG['iou_threshold']})")

    # Verify model exists
    model_path = CONFIG["model_path"]
    if not os.path.exists(model_path):
        print(f"\nERROR: Model not found at {model_path}")
        sys.exit(1)

    # Initialize detector (shared across videos)
    detector = FishDetector(
        model_path=model_path,
        conf_threshold=CONFIG["confidence_threshold"],
        input_size=CONFIG["input_size"],
    )

    # CSV logger
    csv_logger = CSVLogger(CONFIG["csv_output"])

    # Define input/output pairs
    videos = [
        ("black.mp4", "output_black.mp4"),
        ("pineapple.mp4", "output_pineapple.mp4"),
        ("platinum.mp4", "output_platinum.mp4"),
    ]

    results = {}
    total_start = time.time()

    for input_name, output_name in videos:
        input_path = os.path.join(CONFIG["input_dir"], input_name)
        output_path = os.path.join(CONFIG["output_dir"], output_name)

        if not os.path.exists(input_path):
            print(f"\nWARNING: Input video not found: {input_path}, skipping.")
            continue

        count = process_video(input_path, output_path, detector, CONFIG,
                              csv_logger)
        results[input_name] = count

    # Save CSV
    csv_logger.save()

    # Final report
    elapsed = time.time() - total_start
    print(f"\n{'='*60}")
    print("FINAL RESULTS")
    print(f"{'='*60}")
    for name, count in results.items():
        print(f"  {name:20s} → {count} fish counted")
    print(f"\n  Total processing time: {elapsed:.1f}s")
    print(f"  Output files: {', '.join(v[1] for v in videos)}")
    print(f"  Tracking log: {CONFIG['csv_output']}")


if __name__ == "__main__":
    main()

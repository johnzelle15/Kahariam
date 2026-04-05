"""
test_video.py — Run fish detection on a video file
====================================================
Change VIDEO_NAME below, then run:
    python test_video.py
"""

# ============================================================
# CHANGE THIS — just the filename (must be in the same folder)
# ============================================================
VIDEO_NAME = "platinum.mp4"
# ============================================================

import sys
import time
from collections import Counter
from pathlib import Path

import cv2
from ultralytics import YOLO

# --- Paths ---
SCRIPT_DIR = Path(__file__).resolve().parent
VIDEO_PATH = SCRIPT_DIR / VIDEO_NAME
MODEL_PATH = SCRIPT_DIR.parent / "models" / "fish_detector.pt"
OUTPUT_DIR = SCRIPT_DIR / "evaluation"
OUTPUT_DIR.mkdir(exist_ok=True)

# --- Settings ---
CONF_THRESH = 0.35
IOU_THRESH  = 0.45
IMG_SIZE    = 480
RESIZE_W    = 640          # resize input frames (None = keep original)
RESIZE_H    = 360
FRAME_SKIP  = 2            # process every Nth frame (1 = all frames)

CLASS_NAMES = ["Black", "Pineapple", "Platinum"]


def main():
    # Validate inputs
    if not VIDEO_PATH.exists():
        print(f"[ERROR] Video not found: {VIDEO_PATH}")
        sys.exit(1)
    if not MODEL_PATH.exists():
        print(f"[ERROR] Model not found: {MODEL_PATH}")
        sys.exit(1)

    print(f"[INFO] Video : {VIDEO_PATH.name}")
    print(f"[INFO] Model : {MODEL_PATH}")
    print(f"[INFO] Conf  : {CONF_THRESH}  |  IoU: {IOU_THRESH}")
    print()

    # Load model
    model = YOLO(str(MODEL_PATH))

    # Open video
    cap = cv2.VideoCapture(str(VIDEO_PATH))
    if not cap.isOpened():
        print("[ERROR] Cannot open video.")
        sys.exit(1)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Output video (use resized dimensions if set)
    out_w = RESIZE_W or w
    out_h = RESIZE_H or h
    stem = Path(VIDEO_NAME).stem
    out_path = OUTPUT_DIR / f"{stem}_detected.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_path), fourcc, fps_video, (out_w, out_h))

    # CSV log
    csv_path = OUTPUT_DIR / f"{stem}_counts.csv"
    csv_file = open(csv_path, "w", encoding="utf-8")
    csv_file.write("frame,total,Platinum,Black,Pineapple\n")

    frame_idx = 0
    fps_list = []
    grand_counts = Counter()

    print(f"[INFO] Processing {total_frames} frames ({w}x{h} @ {fps_video:.1f} FPS)...")
    print("-" * 60)

    last_counts = Counter()  # reuse counts on skipped frames

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Resize for speed
            if RESIZE_W and RESIZE_H:
                frame = cv2.resize(frame, (RESIZE_W, RESIZE_H),
                                   interpolation=cv2.INTER_LINEAR)

            run_detect = (FRAME_SKIP <= 1) or (frame_idx % FRAME_SKIP == 0)

            if run_detect:
                t0 = time.time()
                results = model.predict(
                    frame,
                    conf=CONF_THRESH,
                    iou=IOU_THRESH,
                    imgsz=IMG_SIZE,
                    device="cpu",
                    verbose=False,
                )
                dt = time.time() - t0
                fps = 1.0 / max(dt, 1e-6)
                fps_list.append(fps)

                # Count detections
                counts = Counter()
                r = results[0]
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    name = CLASS_NAMES[min(cls_id, len(CLASS_NAMES) - 1)]
                    counts[name] += 1
                    grand_counts[name] += 1

                last_counts = counts
                annotated = r.plot()
            else:
                counts = last_counts
                annotated = frame

            total = sum(counts.values())

            # Write CSV row
            csv_file.write(
                f"{frame_idx},{total},"
                f"{counts.get('Platinum',0)},"
                f"{counts.get('Black',0)},"
                f"{counts.get('Pineapple',0)}\n"
            )

            # Write output frame (resize to match writer dimensions)
            out_frame = cv2.resize(annotated, (out_w, out_h),
                                   interpolation=cv2.INTER_LINEAR)
            writer.write(out_frame)

            # Progress every 100 frames
            if frame_idx % 100 == 0:
                pct = frame_idx / max(total_frames, 1) * 100
                avg_fps = fps_list[-1] if fps_list else 0
                print(f"  Frame {frame_idx:>5}/{total_frames}  ({pct:5.1f}%)  "
                      f"FPS={avg_fps:.1f}  fish={total}")

            frame_idx += 1

    except KeyboardInterrupt:
        print("\n[INTERRUPTED]")
    finally:
        cap.release()
        writer.release()
        csv_file.close()

    # --- Summary ---
    print("-" * 60)
    print(f"[DONE] Processed {frame_idx} frames")
    if fps_list:
        print(f"[INFO] Avg inference FPS: {sum(fps_list)/len(fps_list):.1f}")
    print()
    print("Detection summary (total across all frames):")
    for name in CLASS_NAMES:
        print(f"  {name:>12}: {grand_counts.get(name, 0)}")
    print(f"  {'TOTAL':>12}: {sum(grand_counts.values())}")
    print()
    print(f"Output video : {out_path}")
    print(f"Counts CSV   : {csv_path}")


if __name__ == "__main__":
    main()

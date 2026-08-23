"""
rpi5_inference.py — Lightweight YOLOv8n inference for Raspberry Pi 5
====================================================================
Runs real-time detection + fish counting using ONNX Runtime or TFLite.
Designed for low-resource deployment on RPi5 (no GPU required).

Usage (on Raspberry Pi 5):
    # ONNX Runtime (recommended — easiest setup)
    python rpi5_inference.py --model exports/best.onnx --source 0

    # TFLite
    python rpi5_inference.py --model exports/best_float16.tflite --source 0

    # Image or video file
    python rpi5_inference.py --model exports/best.onnx --source fish_video.mp4
    python rpi5_inference.py --model exports/best.onnx --source test_image.jpg

RPi5 setup:
    pip install ultralytics opencv-python-headless numpy onnxruntime
    # For TFLite: pip install tflite-runtime
"""

import argparse
import time
from collections import Counter
from pathlib import Path
import cv2
import numpy as np

# ---- Class names (must match data.yaml order: 0=black, 1=pineapple, 2=platinum)
CLASS_NAMES = ["Black", "Pineapple", "Platinum"]
CLASS_COLORS = [
    (40, 40, 40),     # Black — dark
    (0, 200, 255),    # Pineapple — yellow-orange
    (200, 200, 200),  # Platinum — silver
]

# ---- Optional Kalman SORT tracker import
_tracker_available = False
try:
    from vision.kalman_tracker import KalmanSortTracker
    _tracker_available = True
except ImportError:
    pass


def load_onnx_session(model_path: str):
    """Load ONNX Runtime inference session."""
    import onnxruntime as ort
    providers = ["CPUExecutionProvider"]
    session = ort.InferenceSession(model_path, providers=providers)
    input_name = session.get_inputs()[0].name
    input_shape = session.get_inputs()[0].shape  # e.g. [1, 3, 640, 640]
    return session, input_name, input_shape


def preprocess(frame, imgsz):
    """Resize, pad, normalize for YOLO input."""
    h, w = frame.shape[:2]
    scale = min(imgsz / h, imgsz / w)
    nh, nw = int(h * scale), int(w * scale)
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)

    # Pad to square
    canvas = np.full((imgsz, imgsz, 3), 114, dtype=np.uint8)
    top = (imgsz - nh) // 2
    left = (imgsz - nw) // 2
    canvas[top:top + nh, left:left + nw] = resized

    # HWC → CHW, BGR → RGB, normalize to [0, 1]
    blob = canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
    blob = np.expand_dims(blob, 0)  # add batch dim
    return blob, scale, top, left


def postprocess(output, conf_thresh, iou_thresh, scale, pad_top, pad_left, orig_h, orig_w):
    """Parse YOLO output and apply NMS. Returns list of (x1,y1,x2,y2,conf,cls)."""
    # output shape: [1, 84, 8400] for YOLOv8 (4 box + 80 cls) or [1, 7, 8400] (4+3)
    preds = output[0]  # [84, 8400] or [7, 8400]
    if preds.shape[0] < preds.shape[1]:
        preds = preds.T  # → [8400, 7]

    boxes_xywh = preds[:, :4]
    class_probs = preds[:, 4:]
    num_classes = class_probs.shape[1]

    # Filter by confidence
    max_conf = class_probs.max(axis=1)
    mask = max_conf > conf_thresh
    boxes_xywh = boxes_xywh[mask]
    class_probs = class_probs[mask]
    max_conf = max_conf[mask]
    class_ids = class_probs.argmax(axis=1)

    if len(boxes_xywh) == 0:
        return []

    # xywh → xyxy
    x, y, w, h = boxes_xywh[:, 0], boxes_xywh[:, 1], boxes_xywh[:, 2], boxes_xywh[:, 3]
    x1 = x - w / 2
    y1 = y - h / 2
    x2 = x + w / 2
    y2 = y + h / 2

    # Remove padding and rescale to original image
    x1 = (x1 - pad_left) / scale
    y1 = (y1 - pad_top) / scale
    x2 = (x2 - pad_left) / scale
    y2 = (y2 - pad_top) / scale

    # Clip
    x1 = np.clip(x1, 0, orig_w)
    y1 = np.clip(y1, 0, orig_h)
    x2 = np.clip(x2, 0, orig_w)
    y2 = np.clip(y2, 0, orig_h)

    # NMS
    boxes_xyxy = np.stack([x1, y1, x2, y2], axis=1)
    indices = nms(boxes_xyxy, max_conf, iou_thresh)

    results = []
    for i in indices:
        results.append((
            int(x1[i]), int(y1[i]), int(x2[i]), int(y2[i]),
            float(max_conf[i]), int(class_ids[i])
        ))
    return results


def nms(boxes, scores, iou_thresh):
    """Simple NMS implementation (no torch dependency)."""
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []

    while len(order) > 0:
        i = order[0]
        keep.append(i)
        if len(order) == 1:
            break

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        w = np.maximum(0, xx2 - xx1)
        h = np.maximum(0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)

        inds = np.where(iou <= iou_thresh)[0]
        order = order[inds + 1]

    return keep


def draw_results(frame, detections):
    """Draw bounding boxes and fish counts on frame."""
    counts = Counter()

    for (x1, y1, x2, y2, conf, cls_id) in detections:
        cls_id = min(cls_id, len(CLASS_NAMES) - 1)
        name = CLASS_NAMES[cls_id]
        color = CLASS_COLORS[cls_id]
        counts[name] += 1

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        label = f"{name} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw, y1), color, -1)
        cv2.putText(frame, label, (x1, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    # Fish count overlay (top-left)
    y_off = 30
    total = sum(counts.values())
    cv2.putText(frame, f"Total fish: {total}", (10, y_off),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    y_off += 30
    for name in CLASS_NAMES:
        c = counts.get(name, 0)
        cv2.putText(frame, f"  {name}: {c}", (10, y_off),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1)
        y_off += 25

    return frame, counts


def run_ultralytics(model_path, source, conf, iou, show):
    """Fallback: use Ultralytics YOLO directly (works with .pt, .onnx, .tflite)."""
    from ultralytics import YOLO
    model = YOLO(model_path)
    results = model.predict(
        source=source,
        conf=conf,
        iou=iou,
        stream=True,
        show=show,
        verbose=False,
    )
    for r in results:
        boxes = r.boxes
        counts = Counter()
        for box in boxes:
            cls = int(box.cls[0])
            name = CLASS_NAMES[min(cls, len(CLASS_NAMES) - 1)]
            counts[name] += 1
        total = sum(counts.values())
        parts = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        print(f"[Detection] Total={total}  {parts}")


def run_onnx(model_path, source, imgsz, conf, iou, show, use_tracker=False):
    """Run inference using ONNX Runtime (lightweight, no PyTorch needed)."""
    session, input_name, input_shape = load_onnx_session(model_path)
    infer_imgsz = input_shape[2] if input_shape[2] is not None else imgsz

    # Initialise Kalman tracker if requested
    tracker = None
    if use_tracker and _tracker_available:
        tracker = KalmanSortTracker(max_age=20, min_hits=3, iou_threshold=0.20)
        print("[INFO] Kalman SORT tracker enabled")

    # Determine source type
    source_path = Path(source) if not source.isdigit() else None
    is_camera = source.isdigit()
    is_image = source_path and source_path.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp")

    cap = cv2.VideoCapture(int(source) if is_camera else source)
    if not cap.isOpened():
        # Try as single image
        frame = cv2.imread(source)
        if frame is None:
            print(f"[ERROR] Cannot open source: {source}")
            return
        blob, scale, top, left = preprocess(frame, infer_imgsz)
        output = session.run(None, {input_name: blob})[0]
        dets = postprocess(output, conf, iou, scale, top, left, frame.shape[0], frame.shape[1])
        frame, counts = draw_results(frame, dets)
        total = sum(counts.values())
        print(f"[Detection] Total={total}  {dict(counts)}")
        if show:
            cv2.imshow("Fish Detector", frame)
            cv2.waitKey(0)
        cv2.imwrite("detection_result.jpg", frame)
        print("[OK] Saved detection_result.jpg")
        return

    fps_avg = []
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            t0 = time.time()
            blob, scale, top, left = preprocess(frame, infer_imgsz)
            output = session.run(None, {input_name: blob})[0]
            dets = postprocess(output, conf, iou, scale, top, left,
                               frame.shape[0], frame.shape[1])
            dt = time.time() - t0
            fps = 1.0 / max(dt, 1e-6)
            fps_avg.append(fps)

            # Update Kalman tracker if enabled
            if tracker is not None:
                tracker_dets = [((d[0], d[1], d[2], d[3]), d[4], d[5]) for d in dets]
                active = tracker.update(tracker_dets)
                # Draw tracked boxes with IDs
                for tid, obj in active.items():
                    x1, y1, x2, y2 = obj.bbox
                    cls_id = min(obj.class_id, len(CLASS_COLORS) - 1)
                    color = CLASS_COLORS[cls_id]
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    label = f"ID{tid} {CLASS_NAMES[cls_id]} {obj.confidence:.2f}"
                    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw, y1), color, -1)
                    cv2.putText(frame, label, (x1, y1 - 4),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                cv2.putText(frame, f"Tracks: {len(active)}", (10, frame.shape[0] - 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            else:
                frame, counts = draw_results(frame, dets)
            cv2.putText(frame, f"FPS: {fps:.1f}", (10, frame.shape[0] - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

            if show:
                cv2.imshow("Fish Detector — RPi5", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            else:
                total = sum(counts.values())
                parts = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
                print(f"[{fps:.1f} FPS] Total={total}  {parts}")

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        cv2.destroyAllWindows()
        if fps_avg:
            print(f"\nAverage FPS: {sum(fps_avg)/len(fps_avg):.1f}")


def main():
    parser = argparse.ArgumentParser(
        description="Fish detection on Raspberry Pi 5 (ONNX / TFLite)")
    parser.add_argument("--model", required=True,
                        help="model path (.onnx, .tflite, or .pt)")
    parser.add_argument("--source", default="0",
                        help="camera index, video file, or image path")
    parser.add_argument("--imgsz", type=int, default=640,
                        help="inference image size")
    parser.add_argument("--conf", type=float, default=0.5,
                        help="confidence threshold")
    parser.add_argument("--iou", type=float, default=0.45,
                        help="NMS IoU threshold")
    parser.add_argument("--show", action="store_true", default=True,
                        help="show live display (default: True)")
    parser.add_argument("--no-show", dest="show", action="store_false",
                        help="headless mode (no display)")
    parser.add_argument("--track", action="store_true", default=False,
                        help="enable Kalman SORT tracking (show track IDs)")
    args = parser.parse_args()

    model_path = args.model
    ext = Path(model_path).suffix.lower()

    print(f"[INFO] Model: {model_path}")
    print(f"[INFO] Source: {args.source}")
    print(f"[INFO] Conf: {args.conf}, IoU: {args.iou}")

    if ext == ".onnx":
        run_onnx(model_path, args.source, args.imgsz, args.conf, args.iou, args.show, args.track)
    elif ext in (".tflite", ".pt"):
        # Use Ultralytics for .pt and .tflite (handles TFLite runtime)
        run_ultralytics(model_path, args.source, args.conf, args.iou, args.show)
    else:
        print(f"[ERROR] Unsupported model format: {ext}")
        print("        Supported: .onnx, .tflite, .pt")


if __name__ == "__main__":
    main()

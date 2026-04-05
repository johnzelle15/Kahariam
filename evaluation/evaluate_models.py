#!/usr/bin/env python3
"""
evaluate_models.py — Comprehensive YOLO Model Evaluation for RPi 5
===================================================================
Evaluates all ONNX models on test videos, measuring:
  - Inference FPS (real RPi 5 CPU timing)
  - Per-class detection accuracy (Precision, Recall, F1)
  - Confusion matrix for fish classes
  - Model size and latency

Output: structured report + CSV summary
"""

import os
import sys
import time
import csv
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

# Suppress ONNX Runtime warnings
os.environ["ORT_LOG_LEVEL"] = "3"

import onnxruntime as ort

# ==== Configuration ====
CLASS_NAMES = ["Black", "Pineapple", "Platinum"]  # alphabetical — matches training data.yaml
CONF_THRESH = 0.35
IOU_THRESH = 0.45
WARMUP_FRAMES = 10  # warmup frames before timing
MAX_EVAL_FRAMES = 300  # max frames per video for speed eval (0 = all)

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent

VIDEO_DIR = _SCRIPT_DIR / "videos"
VIDEOS = {
    "platinum": VIDEO_DIR / "platinum.mp4",
    "black": VIDEO_DIR / "black.mp4",
    "pineapple": VIDEO_DIR / "pineapple.mp4",
}

MODELS = {
    "YOLOv11n_640": str(_PROJECT_ROOT / "training" / "runs" / "export" / "model_640.onnx"),
    "YOLOv11n_480": str(_PROJECT_ROOT / "training" / "runs" / "export" / "yolov11n_480.onnx"),
    "YOLOv11n_320": str(_PROJECT_ROOT / "training" / "runs" / "export" / "model_320.onnx"),
    "YOLOv11s_640": str(_PROJECT_ROOT / "training" / "runs" / "export" / "model_small_640.onnx"),
}

OUTPUT_DIR = _SCRIPT_DIR / "results"
OUTPUT_DIR.mkdir(exist_ok=True)


# ==== Preprocessing / Postprocessing (from rpi5_inference.py) ====

def preprocess(frame, imgsz):
    """Resize, letterbox-pad, normalize for YOLO input."""
    h, w = frame.shape[:2]
    scale = min(imgsz / h, imgsz / w)
    nh, nw = int(h * scale), int(w * scale)
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)

    canvas = np.full((imgsz, imgsz, 3), 114, dtype=np.uint8)
    top = (imgsz - nh) // 2
    left = (imgsz - nw) // 2
    canvas[top:top + nh, left:left + nw] = resized

    blob = canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
    blob = np.expand_dims(blob, 0)
    return blob, scale, top, left


def nms(boxes, scores, iou_thresh):
    """Simple NMS — no torch required."""
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


def postprocess(output, conf_thresh, iou_thresh, scale, pad_top, pad_left, orig_h, orig_w):
    """Parse YOLO output → list of (x1, y1, x2, y2, conf, cls_id)."""
    preds = output[0]
    if preds.shape[0] < preds.shape[1]:
        preds = preds.T

    boxes_xywh = preds[:, :4]
    class_probs = preds[:, 4:]

    max_conf = class_probs.max(axis=1)
    mask = max_conf > conf_thresh
    boxes_xywh = boxes_xywh[mask]
    class_probs = class_probs[mask]
    max_conf = max_conf[mask]
    class_ids = class_probs.argmax(axis=1)

    if len(boxes_xywh) == 0:
        return []

    x, y, w, h = boxes_xywh[:, 0], boxes_xywh[:, 1], boxes_xywh[:, 2], boxes_xywh[:, 3]
    x1 = (x - w / 2 - pad_left) / scale
    y1 = (y - h / 2 - pad_top) / scale
    x2 = (x + w / 2 - pad_left) / scale
    y2 = (y + h / 2 - pad_top) / scale

    x1 = np.clip(x1, 0, orig_w)
    y1 = np.clip(y1, 0, orig_h)
    x2 = np.clip(x2, 0, orig_w)
    y2 = np.clip(y2, 0, orig_h)

    boxes_xyxy = np.stack([x1, y1, x2, y2], axis=1)
    indices = nms(boxes_xyxy, max_conf, iou_thresh)

    results = []
    for i in indices:
        results.append((int(x1[i]), int(y1[i]), int(x2[i]), int(y2[i]),
                         float(max_conf[i]), int(class_ids[i])))
    return results


# ==== Evaluation Engine ====

def load_model(model_path):
    """Load ONNX model, return session + metadata."""
    sess_opts = ort.SessionOptions()
    sess_opts.intra_op_num_threads = 4
    sess_opts.inter_op_num_threads = 1
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    session = ort.InferenceSession(model_path, sess_opts, providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    imgsz = input_meta.shape[2]  # e.g. 640, 480, 320
    return session, input_meta.name, imgsz


def evaluate_model_on_video(session, input_name, imgsz, video_path, expected_class):
    """
    Run model on video, return timing and detection stats.
    expected_class: the fish class this video predominantly contains.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  [ERROR] Cannot open {video_path}")
        return None

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    eval_frames = min(total_frames, MAX_EVAL_FRAMES) if MAX_EVAL_FRAMES > 0 else total_frames

    inference_times = []
    class_detections = Counter()  # cls_id → count across all frames
    frame_count = 0
    total_detections = 0
    confidences = []

    while frame_count < eval_frames + WARMUP_FRAMES:
        ret, frame = cap.read()
        if not ret:
            break

        orig_h, orig_w = frame.shape[:2]
        blob, scale, pad_top, pad_left = preprocess(frame, imgsz)

        # Inference timing
        t0 = time.perf_counter()
        output = session.run(None, {input_name: blob})
        t1 = time.perf_counter()

        detections = postprocess(output[0], CONF_THRESH, IOU_THRESH,
                                 scale, pad_top, pad_left, orig_h, orig_w)

        if frame_count >= WARMUP_FRAMES:
            inference_times.append(t1 - t0)
            for (x1, y1, x2, y2, conf, cls_id) in detections:
                cls_id = min(cls_id, len(CLASS_NAMES) - 1)
                class_detections[CLASS_NAMES[cls_id]] += 1
                confidences.append(conf)
                total_detections += 1

        frame_count += 1

    cap.release()

    if not inference_times:
        return None

    avg_time = np.mean(inference_times)
    std_time = np.std(inference_times)
    fps = 1.0 / avg_time if avg_time > 0 else 0
    p50 = np.percentile(inference_times, 50) * 1000
    p95 = np.percentile(inference_times, 95) * 1000
    avg_conf = np.mean(confidences) if confidences else 0

    # Determine classification accuracy for this video
    # Each video is named after the dominant class
    expected = expected_class.capitalize()
    correct = class_detections.get(expected, 0)
    accuracy = correct / total_detections if total_detections > 0 else 0

    return {
        "frames_evaluated": len(inference_times),
        "avg_inference_ms": avg_time * 1000,
        "std_inference_ms": std_time * 1000,
        "p50_ms": p50,
        "p95_ms": p95,
        "fps": fps,
        "total_detections": total_detections,
        "class_detections": dict(class_detections),
        "expected_class": expected,
        "correct_detections": correct,
        "accuracy": accuracy,
        "avg_confidence": avg_conf,
    }


def build_confusion_matrix(results_by_video):
    """
    Build per-model confusion matrix from video results.
    Rows = true class (from video name), Columns = predicted class.
    """
    matrix = defaultdict(lambda: defaultdict(int))
    for video_name, result in results_by_video.items():
        true_class = result["expected_class"]
        for pred_class, count in result["class_detections"].items():
            matrix[true_class][pred_class] += count
    return matrix


def compute_metrics(confusion):
    """Compute per-class P/R/F1 and macro averages from confusion matrix."""
    classes = CLASS_NAMES
    metrics = {}
    total_tp = 0
    total_samples = 0

    for cls in classes:
        tp = confusion.get(cls, {}).get(cls, 0)
        # FP: other classes predicted as this class
        fp = sum(confusion.get(other, {}).get(cls, 0) for other in classes if other != cls)
        # FN: this class predicted as other classes
        fn = sum(confusion.get(cls, {}).get(other, 0) for other in classes if other != cls)
        support = tp + fn

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        metrics[cls] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": support,
            "tp": tp, "fp": fp, "fn": fn,
        }
        total_tp += tp
        total_samples += support

    # Macro averages
    macro_p = np.mean([m["precision"] for m in metrics.values()])
    macro_r = np.mean([m["recall"] for m in metrics.values()])
    macro_f1 = np.mean([m["f1"] for m in metrics.values()])
    accuracy = total_tp / total_samples if total_samples > 0 else 0

    return metrics, {
        "macro_precision": macro_p,
        "macro_recall": macro_r,
        "macro_f1": macro_f1,
        "accuracy": accuracy,
    }


def format_confusion_matrix(confusion):
    """Pretty-print confusion matrix."""
    classes = CLASS_NAMES
    lines = []
    header = f"{'':>12s}" + "".join(f"{c:>12s}" for c in classes)
    lines.append(header)
    for true_cls in classes:
        row = f"{true_cls:>12s}"
        for pred_cls in classes:
            count = confusion.get(true_cls, {}).get(pred_cls, 0)
            row += f"{count:>12d}"
        lines.append(row)
    return "\n".join(lines)


def format_normalized_confusion(confusion):
    """Pretty-print normalized confusion matrix."""
    classes = CLASS_NAMES
    lines = []
    header = f"{'':>12s}" + "".join(f"{c:>12s}" for c in classes)
    lines.append(header)
    for true_cls in classes:
        row_total = sum(confusion.get(true_cls, {}).values())
        row = f"{true_cls:>12s}"
        for pred_cls in classes:
            count = confusion.get(true_cls, {}).get(pred_cls, 0)
            norm = count / row_total if row_total > 0 else 0
            row += f"{norm:>12.4f}"
        lines.append(row)
    return "\n".join(lines)


# ==== Main ====

def main():
    print("=" * 72)
    print("  YOLO Model Evaluation — Raspberry Pi 5 CPU Benchmark")
    print("  Fish Classes:", CLASS_NAMES)
    print(f"  Confidence threshold: {CONF_THRESH}, IoU threshold: {IOU_THRESH}")
    print(f"  Max eval frames/video: {MAX_EVAL_FRAMES}")
    print("=" * 72)

    all_results = {}
    summary_rows = []

    for model_name, model_path in MODELS.items():
        print(f"\n{'─' * 72}")
        print(f"  Model: {model_name}")
        print(f"  Path:  {model_path}")

        if not Path(model_path).exists():
            print(f"  [SKIP] File not found")
            continue

        model_size_mb = Path(model_path).stat().st_size / (1024 * 1024)
        print(f"  Size:  {model_size_mb:.1f} MB")

        session, input_name, imgsz = load_model(model_path)
        print(f"  Input: {imgsz}×{imgsz}")
        print()

        model_results = {}
        all_fps = []

        for video_name, video_path in VIDEOS.items():
            print(f"  Testing on {video_name}.mp4 ...", end=" ", flush=True)
            result = evaluate_model_on_video(
                session, input_name, imgsz, video_path, video_name
            )
            if result is None:
                print("[FAILED]")
                continue

            model_results[video_name] = result
            all_fps.append(result["fps"])
            print(f"FPS={result['fps']:.1f}  "
                  f"dets={result['total_detections']}  "
                  f"acc={result['accuracy']:.1%}  "
                  f"latency={result['avg_inference_ms']:.1f}ms")

        # Build confusion matrix
        confusion = build_confusion_matrix(model_results)
        per_class, macro = compute_metrics(confusion)

        avg_fps = np.mean(all_fps) if all_fps else 0
        avg_latency = 1000.0 / avg_fps if avg_fps > 0 else float("inf")

        # ---- Print per-model report ----
        print(f"\n  === {model_name} Results ===")
        print(f"  Average FPS:       {avg_fps:.1f}")
        print(f"  Average latency:   {avg_latency:.1f} ms")
        print(f"  Model size:        {model_size_mb:.1f} MB")
        print(f"  Macro Precision:   {macro['macro_precision']:.4f}")
        print(f"  Macro Recall:      {macro['macro_recall']:.4f}")
        print(f"  Macro F1:          {macro['macro_f1']:.4f}")
        print(f"  Overall Accuracy:  {macro['accuracy']:.4f}")

        print(f"\n  Per-class metrics:")
        print(f"  {'Class':>12s} {'Precision':>10s} {'Recall':>10s} {'F1':>10s} {'Support':>8s}")
        for cls in CLASS_NAMES:
            m = per_class.get(cls, {})
            print(f"  {cls:>12s} {m.get('precision',0):>10.4f} {m.get('recall',0):>10.4f} "
                  f"{m.get('f1',0):>10.4f} {m.get('support',0):>8d}")

        print(f"\n  Confusion Matrix (rows=true, cols=predicted):")
        for line in format_confusion_matrix(confusion).split("\n"):
            print(f"  {line}")

        print(f"\n  Normalized Confusion Matrix:")
        for line in format_normalized_confusion(confusion).split("\n"):
            print(f"  {line}")

        # Platinum-specific analysis
        pt_metrics = per_class.get("Platinum", {})
        print(f"\n  ★ Platinum Focus:")
        print(f"    Precision: {pt_metrics.get('precision', 0):.4f}")
        print(f"    Recall:    {pt_metrics.get('recall', 0):.4f}")
        print(f"    F1:        {pt_metrics.get('f1', 0):.4f}")
        pt_conf = confusion.get("Platinum", {})
        total_pt = sum(pt_conf.values())
        if total_pt > 0:
            for other in CLASS_NAMES:
                if other != "Platinum" and pt_conf.get(other, 0) > 0:
                    rate = pt_conf[other] / total_pt
                    print(f"    Misclassified as {other}: {pt_conf[other]} ({rate:.1%})")

        # Per-video latency breakdown
        print(f"\n  Latency breakdown:")
        for vname, res in model_results.items():
            print(f"    {vname}: avg={res['avg_inference_ms']:.1f}ms  "
                  f"p50={res['p50_ms']:.1f}ms  p95={res['p95_ms']:.1f}ms  "
                  f"std={res['std_inference_ms']:.1f}ms")

        all_results[model_name] = {
            "model_size_mb": model_size_mb,
            "imgsz": imgsz,
            "avg_fps": avg_fps,
            "avg_latency_ms": avg_latency,
            "per_class": per_class,
            "macro": macro,
            "confusion": confusion,
            "pt_metrics": pt_metrics,
            "video_results": model_results,
        }

        summary_rows.append({
            "Model": model_name,
            "Input": f"{imgsz}×{imgsz}",
            "Size_MB": f"{model_size_mb:.1f}",
            "FPS": f"{avg_fps:.1f}",
            "Latency_ms": f"{avg_latency:.1f}",
            "Precision": f"{macro['macro_precision']:.4f}",
            "Recall": f"{macro['macro_recall']:.4f}",
            "F1": f"{macro['macro_f1']:.4f}",
            "Accuracy": f"{macro['accuracy']:.4f}",
            "Pt_Precision": f"{pt_metrics.get('precision', 0):.4f}",
            "Pt_Recall": f"{pt_metrics.get('recall', 0):.4f}",
            "Pt_F1": f"{pt_metrics.get('f1', 0):.4f}",
        })

        del session  # free memory

    # ==== Summary Comparison Table ====
    print("\n" + "=" * 72)
    print("  SUMMARY COMPARISON TABLE")
    print("=" * 72)

    cols = ["Model", "Input", "Size_MB", "FPS", "Latency_ms",
            "Precision", "Recall", "F1", "Accuracy",
            "Pt_Precision", "Pt_Recall", "Pt_F1"]
    widths = [16, 9, 8, 6, 11, 10, 8, 8, 9, 13, 11, 8]

    header = ""
    for col, w in zip(cols, widths):
        header += f"{col:>{w}s} "
    print(header)
    print("─" * len(header))

    for row in summary_rows:
        line = ""
        for col, w in zip(cols, widths):
            line += f"{row[col]:>{w}s} "
        print(line)

    # ==== FPS vs Accuracy Tradeoff ====
    print("\n" + "=" * 72)
    print("  FPS vs ACCURACY TRADEOFF")
    print("=" * 72)
    for row in sorted(summary_rows, key=lambda r: float(r["FPS"]), reverse=True):
        fps_val = float(row["FPS"])
        acc_val = float(row["Accuracy"])
        bar_fps = "█" * int(fps_val)
        bar_acc = "█" * int(acc_val * 50)
        print(f"  {row['Model']:<16s}  FPS: {fps_val:5.1f}  |{bar_fps}")
        print(f"  {'':16s}  Acc: {acc_val:.3f}  |{bar_acc}")
        print()

    # ==== Model Size vs Latency ====
    print("=" * 72)
    print("  MODEL SIZE vs LATENCY")
    print("=" * 72)
    for row in sorted(summary_rows, key=lambda r: float(r["Size_MB"])):
        print(f"  {row['Model']:<16s}  Size: {row['Size_MB']:>5s} MB  "
              f"Latency: {row['Latency_ms']:>6s} ms  FPS: {row['FPS']:>5s}")

    # ==== Final Recommendation ====
    print("\n" + "=" * 72)
    print("  FINAL RECOMMENDATION")
    print("=" * 72)

    # Score: weighted FPS + accuracy + platinum F1
    best_score = -1
    best_model = None
    for name, data in all_results.items():
        fps_norm = min(data["avg_fps"] / 30.0, 1.0)  # normalize to 30fps target
        acc_norm = data["macro"]["accuracy"]
        pt_f1 = data["pt_metrics"].get("f1", 0)
        # Weight: 40% FPS, 35% accuracy, 25% platinum F1
        score = 0.40 * fps_norm + 0.35 * acc_norm + 0.25 * pt_f1
        print(f"  {name}: score={score:.4f} "
              f"(FPS:{fps_norm:.3f} Acc:{acc_norm:.3f} PtF1:{pt_f1:.3f})")
        if score > best_score:
            best_score = score
            best_model = name

    if best_model:
        bd = all_results[best_model]
        print(f"\n  ✅ RECOMMENDED MODEL: {best_model}")
        print(f"     Input size:      {bd['imgsz']}×{bd['imgsz']}")
        print(f"     Model size:      {bd['model_size_mb']:.1f} MB")
        print(f"     Average FPS:     {bd['avg_fps']:.1f}")
        print(f"     Avg latency:     {bd['avg_latency_ms']:.1f} ms")
        print(f"     Macro F1:        {bd['macro']['macro_f1']:.4f}")
        print(f"     Platinum F1:     {bd['pt_metrics'].get('f1', 0):.4f}")
        print(f"     Overall Accuracy:{bd['macro']['accuracy']:.4f}")

    # ==== Optimization Recommendations ====
    print(f"\n{'=' * 72}")
    print("  OPTIMIZATION RECOMMENDATIONS FOR RPi 5 DEPLOYMENT")
    print("=" * 72)
    print("""
  1. INT8 QUANTIZATION (highest FPS gain):
     - Convert ONNX → INT8 using ONNX Runtime quantization:
         from onnxruntime.quantization import quantize_dynamic, QuantType
         quantize_dynamic("model.onnx", "model_int8.onnx",
                          weight_type=QuantType.QUInt8)
     - Expected: 1.5-2x FPS boost with <1% accuracy loss.
     - Also try static quantization with calibration data for better accuracy.

  2. INPUT SIZE REDUCTION:
     - 640→320 gives ~3-4x FPS improvement with moderate accuracy loss.
     - 640→480 is a good middle ground (~1.8x speedup).
     - For fish counting, 320×320 may suffice if fish are close to camera.

  3. NCNN BACKEND (RPi-optimized):
     - Export to NCNN format: model.export(format='ncnn')
     - NCNN is ARM NEON optimized → 20-40% faster than ONNX Runtime on RPi.
     - Already exported for nano: runs/detect/train_nano/weights/best_ncnn_model/

  4. OPENVINO BACKEND:
     - Already exported: runs/detect/train_nano/weights/best_openvino_model/
     - May provide additional speedup on CPU with graph optimizations.

  5. FRAME SKIP STRATEGY:
     - Process every 2nd or 3rd frame to effectively double/triple throughput.
     - Combine with object tracking (e.g., ByteTrack) to maintain count accuracy.
     - Example: 8 FPS inference × skip 2 = effective 16 FPS tracking.

  6. THREADING:
     - Use separate threads for capture vs inference to overlap I/O and compute.
     - ORT sessions already configured with 4 intra-op threads.

  7. BATCH PREPROCESSING:
     - Pre-resize frames to model input size at capture time to reduce latency.
""")

    # ==== Save CSV ====
    csv_path = OUTPUT_DIR / "model_comparison.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=cols)
        writer.writeheader()
        writer.writerows(summary_rows)
    print(f"\n  CSV saved to: {csv_path}")

    # ==== Save full report ====
    report_path = OUTPUT_DIR / "evaluation_report.txt"
    # Re-run print to file
    import io
    buf = io.StringIO()
    _orig_stdout = sys.stdout
    sys.stdout = buf

    print("=" * 72)
    print("  YOLO Model Evaluation Report — Raspberry Pi 5")
    print(f"  Date: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  System: Raspberry Pi 5, aarch64, CPU-only")
    print(f"  ONNX Runtime: {ort.__version__}")
    print(f"  Classes: {CLASS_NAMES}")
    print(f"  Conf threshold: {CONF_THRESH}, IoU: {IOU_THRESH}")
    print("=" * 72)

    for name, data in all_results.items():
        print(f"\n{'─' * 60}")
        print(f"  {name} ({data['imgsz']}×{data['imgsz']}, {data['model_size_mb']:.1f} MB)")
        print(f"  FPS: {data['avg_fps']:.1f} | Latency: {data['avg_latency_ms']:.1f}ms")
        print(f"  Macro P/R/F1: {data['macro']['macro_precision']:.4f} / "
              f"{data['macro']['macro_recall']:.4f} / {data['macro']['macro_f1']:.4f}")
        print(f"  Accuracy: {data['macro']['accuracy']:.4f}")
        print(f"\n  Per-class:")
        for cls in CLASS_NAMES:
            m = data["per_class"].get(cls, {})
            print(f"    {cls}: P={m.get('precision',0):.4f} R={m.get('recall',0):.4f} "
                  f"F1={m.get('f1',0):.4f}")
        print(f"\n  Confusion Matrix:")
        print(f"  {format_confusion_matrix(data['confusion'])}")
        print(f"\n  Normalized:")
        print(f"  {format_normalized_confusion(data['confusion'])}")

    print(f"\n{'=' * 60}")
    print(f"  RECOMMENDED: {best_model}")
    print(f"{'=' * 60}")

    sys.stdout = _orig_stdout
    with open(report_path, "w") as f:
        f.write(buf.getvalue())
    print(f"  Report saved to: {report_path}")

    print(f"\n{'=' * 72}")
    print("  Evaluation complete.")
    print("=" * 72)


if __name__ == "__main__":
    main()

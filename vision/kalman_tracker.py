"""
SORT-Style Kalman Filter Tracker for Fish Counting
====================================================

Replaces the centroid-only tracker with a full Kalman-filter-based
tracker that **predicts** fish positions even when YOLO misses a
detection. This dramatically improves accuracy for:

  - Fast-moving fish (motion blur)
  - Camera shake / instability
  - Frame skipping on edge devices (RPi5)
  - Temporary occlusions

Architecture
------------
Each tracked fish maintains a 7-dimensional Kalman state:

    state = [cx, cy, area, aspect_ratio, vx, vy, v_area]

  - (cx, cy)  : bounding-box centre
  - area      : bounding-box area   (width × height)
  - aspect    : width / height      (nearly constant for fish)
  - vx, vy    : velocity components (learned from observations)
  - v_area    : rate of area change (accounts for depth changes)

On every frame the tracker:
  1. **Predicts** the next position of every existing track
     using its Kalman state (constant-velocity model).
  2. Receives YOLO detections and computes an IoU cost matrix
     between predicted boxes and detected boxes.
  3. Solves the assignment with the Hungarian algorithm.
  4. **Updates** matched tracks with the new measurement.
  5. Creates new tracks for unmatched detections.
  6. Keeps unmatched tracks alive for `max_age` frames using
     the predicted position — this is how fish survive brief
     detection gaps.

Why This Beats Centroid-Only Tracking
-------------------------------------
The old centroid tracker uses Euclidean distance to match
detections and has no motion model.  When a detection is lost
the track simply freezes at its last position and counts down
a `disappeared` timer.  If the fish moves far during those
missed frames, the track cannot be re-associated because the
distance is too large.

With a Kalman filter, the predicted position *follows the fish*
even when YOLO fails to detect it.  The velocity estimate
(vx, vy) propagates the position forward, so when the detection
reappears a few frames later the predicted box overlaps with it
and the match succeeds.

Counting Integration
--------------------
The tracker exposes the same zone / crossing API as the legacy
CentroidTracker so the fish_counter.py main loop requires
minimal changes.  Predicted (unmatched) tracks still update
their zone, which means a fish can be counted even if detection
was lost at the exact moment it crossed the line — because the
Kalman prediction carries the position across.

References
----------
- Bewley et al., "Simple Online and Realtime Tracking" (SORT), 2016
- Kalman, "A New Approach to Linear Filtering and Prediction
  Problems", 1960

Author: Fish Counter Project
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    from scipy.optimize import linear_sum_assignment
except ImportError:
    # Fallback for environments without scipy
    linear_sum_assignment = None


# ─────────────────────────────────────────────────────────────────────────────
# Pure-Python Hungarian fallback (no scipy needed on RPi5)
# ─────────────────────────────────────────────────────────────────────────────

def _greedy_assignment(cost_matrix: np.ndarray):
    """Greedy min-cost matching — O(n²) fallback when scipy is unavailable."""
    rows, cols = cost_matrix.shape
    row_idx, col_idx = [], []
    used_rows, used_cols = set(), set()
    # flatten and sort by cost
    indices = np.argsort(cost_matrix, axis=None)
    for flat_idx in indices:
        r, c = divmod(int(flat_idx), cols)
        if r in used_rows or c in used_cols:
            continue
        row_idx.append(r)
        col_idx.append(c)
        used_rows.add(r)
        used_cols.add(c)
        if len(row_idx) == min(rows, cols):
            break
    return np.array(row_idx, dtype=int), np.array(col_idx, dtype=int)


def solve_assignment(cost_matrix: np.ndarray):
    """Solve the linear assignment problem (Hungarian or greedy fallback)."""
    if linear_sum_assignment is not None:
        return linear_sum_assignment(cost_matrix)
    return _greedy_assignment(cost_matrix)


# ─────────────────────────────────────────────────────────────────────────────
# IoU Computation
# ─────────────────────────────────────────────────────────────────────────────

def _iou_batch(bb_test: np.ndarray, bb_gt: np.ndarray) -> np.ndarray:
    """
    Compute IoU between two sets of bounding boxes.

    Parameters
    ----------
    bb_test : (N, 4) array  — [x1, y1, x2, y2]
    bb_gt   : (M, 4) array  — [x1, y1, x2, y2]

    Returns
    -------
    (N, M) IoU matrix
    """
    bb_test = np.atleast_2d(bb_test).astype(float)
    bb_gt = np.atleast_2d(bb_gt).astype(float)

    xx1 = np.maximum(bb_test[:, 0:1], bb_gt[:, 0])
    yy1 = np.maximum(bb_test[:, 1:2], bb_gt[:, 1])
    xx2 = np.minimum(bb_test[:, 2:3], bb_gt[:, 2])
    yy2 = np.minimum(bb_test[:, 3:4], bb_gt[:, 3])

    w = np.maximum(0.0, xx2 - xx1)
    h = np.maximum(0.0, yy2 - yy1)
    inter = w * h

    area_test = (bb_test[:, 2] - bb_test[:, 0]) * (bb_test[:, 3] - bb_test[:, 1])
    area_gt = (bb_gt[:, 2] - bb_gt[:, 0]) * (bb_gt[:, 3] - bb_gt[:, 1])

    union = area_test[:, None] + area_gt[None, :] - inter
    return inter / np.maximum(union, 1e-6)


# ─────────────────────────────────────────────────────────────────────────────
# Coordinate Conversions
# ─────────────────────────────────────────────────────────────────────────────

def _bbox_to_z(bbox: np.ndarray) -> np.ndarray:
    """Convert [x1, y1, x2, y2] → [cx, cy, area, aspect]."""
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    cx = bbox[0] + w / 2.0
    cy = bbox[1] + h / 2.0
    area = w * h
    aspect = w / max(h, 1e-6)
    return np.array([cx, cy, area, aspect]).reshape(4, 1)


def _z_to_bbox(z: np.ndarray) -> np.ndarray:
    """Convert [cx, cy, area, aspect] → [x1, y1, x2, y2]."""
    cx, cy, area, aspect = z.flatten()[:4]
    area = max(area, 1.0)
    w = np.sqrt(area * aspect)
    h = area / max(w, 1e-6)
    return np.array([
        cx - w / 2.0,
        cy - h / 2.0,
        cx + w / 2.0,
        cy + h / 2.0,
    ])


# ─────────────────────────────────────────────────────────────────────────────
# Kalman-Tracked Object
# ─────────────────────────────────────────────────────────────────────────────

class KalmanTrack:
    """
    Single-object Kalman filter tracker (constant-velocity model).

    State vector (7 × 1):
        [cx, cy, area, aspect_ratio, vx, vy, v_area]^T

    Measurement vector (4 × 1):
        [cx, cy, area, aspect_ratio]^T

    The velocity components (vx, vy, v_area) are *hidden* — they are
    estimated from successive measurements via the Kalman update rule.

    Kalman Filter Mechanics
    -----------------------
    **Predict step** (every frame):
        x̂ₖ|ₖ₋₁ = F · x̂ₖ₋₁|ₖ₋₁        (state prediction)
        Pₖ|ₖ₋₁  = F · Pₖ₋₁|ₖ₋₁ · Fᵀ + Q  (covariance prediction)

        F is the state-transition matrix that encodes the constant-velocity
        assumption: cx_new = cx + vx, etc.

    **Update step** (when a detection is matched):
        ŷ  = z − H · x̂ₖ|ₖ₋₁             (innovation / residual)
        S  = H · Pₖ|ₖ₋₁ · Hᵀ + R         (innovation covariance)
        K  = Pₖ|ₖ₋₁ · Hᵀ · S⁻¹           (Kalman gain)
        x̂ₖ|ₖ = x̂ₖ|ₖ₋₁ + K · ŷ           (corrected state)
        Pₖ|ₖ  = (I − K · H) · Pₖ|ₖ₋₁     (corrected covariance)

    When no detection matches (fish temporarily lost), only the
    predict step runs. The velocity estimate propagates the position
    forward, so when the detection reappears the predicted bounding
    box is close to the actual position and the IoU match succeeds.
    """

    _count = 0  # class-level ID counter

    def __init__(self, bbox: np.ndarray, confidence: float = 0.0,
                 class_id: int = 0):
        """
        Initialise a new Kalman track from a detection bounding box.

        Parameters
        ----------
        bbox : [x1, y1, x2, y2]
        confidence : YOLO confidence score
        class_id : YOLO class index
        """
        # ── Kalman matrices ──────────────────────────────────────────────
        dim_x = 7  # state dimension
        dim_z = 4  # measurement dimension

        # State-transition matrix F (constant velocity model)
        # x(k) = F * x(k-1)
        # [cx]     [1 0 0 0 1 0 0] [cx]
        # [cy]     [0 1 0 0 0 1 0] [cy]
        # [area]   [0 0 1 0 0 0 1] [area]
        # [aspect] = [0 0 0 1 0 0 0] [aspect]
        # [vx]     [0 0 0 0 1 0 0] [vx]
        # [vy]     [0 0 0 0 0 1 0] [vy]
        # [va]     [0 0 0 0 0 0 1] [va]
        self.F = np.eye(dim_x, dtype=float)
        self.F[0, 4] = 1.0   # cx += vx
        self.F[1, 5] = 1.0   # cy += vy
        self.F[2, 6] = 1.0   # area += v_area

        # Measurement matrix H (observe [cx, cy, area, aspect])
        self.H = np.zeros((dim_z, dim_x), dtype=float)
        self.H[:dim_z, :dim_z] = np.eye(dim_z)

        # Measurement noise covariance R
        self.R = np.eye(dim_z, dtype=float)
        self.R[2, 2] *= 10.0   # area measurement is noisier
        self.R[3, 3] *= 10.0   # aspect ratio is noisier

        # Process noise covariance Q
        self.Q = np.eye(dim_x, dtype=float)
        self.Q[4, 4] *= 0.01   # vx process noise
        self.Q[5, 5] *= 0.01   # vy process noise
        self.Q[6, 6] *= 0.0001 # v_area process noise (area changes slowly)
        self.Q[-1, -1] *= 0.01

        # State covariance P (initial uncertainty)
        self.P = np.eye(dim_x, dtype=float) * 10.0
        self.P[4, 4] *= 1000.0   # high uncertainty in initial velocity
        self.P[5, 5] *= 1000.0
        self.P[6, 6] *= 1000.0

        # ── State initialisation ─────────────────────────────────────────
        z = _bbox_to_z(np.asarray(bbox, dtype=float))
        self.x = np.zeros((dim_x, 1), dtype=float)
        self.x[:dim_z] = z  # position known, velocity = 0

        # ── Metadata ─────────────────────────────────────────────────────
        KalmanTrack._count += 1
        self.id = KalmanTrack._count
        self.confidence = confidence
        self.class_id = class_id
        self.age = 0            # total frames since creation
        self.hits = 0           # total matched detections
        self.time_since_update = 0  # consecutive frames without update
        self.hit_streak = 0     # consecutive matched frames

        # ── Counting state ───────────────────────────────────────────────
        self.zone: str = 'unknown'
        self.last_zone: str = 'unknown'
        self.crossed: bool = False
        self.last_counted_frame: int = -100_000

        # ── History for display & diagnostics ────────────────────────────
        self.confidence_history: List[float] = [confidence]
        self.bbox_history: List[np.ndarray] = [np.asarray(bbox)]
        self.class_history: List[int] = [class_id]  # for majority-vote class stabilization

    # ── Kalman predict ───────────────────────────────────────────────────

    def predict(self) -> np.ndarray:
        """
        Advance state one timestep using the constant-velocity model.

        This is the core mechanism that keeps tracks alive when YOLO
        misses a detection: the predicted bounding box moves forward
        according to the estimated velocity (vx, vy).

        Returns
        -------
        Predicted bounding box [x1, y1, x2, y2].
        """
        # Prevent area from going negative
        if self.x[2] + self.x[6] <= 0:
            self.x[6] *= 0.0

        # x̂ = F · x
        self.x = self.F @ self.x
        # P = F · P · Fᵀ + Q
        self.P = self.F @ self.P @ self.F.T + self.Q

        self.age += 1
        if self.time_since_update > 0:
            self.hit_streak = 0
        self.time_since_update += 1
        return self.get_bbox()

    # ── Kalman update ────────────────────────────────────────────────────

    def update(self, bbox: np.ndarray, confidence: float = 0.0,
               class_id: int = 0) -> None:
        """
        Correct the Kalman state with a matched YOLO detection.

        Parameters
        ----------
        bbox : [x1, y1, x2, y2] detected bounding box
        confidence : detection confidence
        class_id : detection class
        """
        z = _bbox_to_z(np.asarray(bbox, dtype=float))  # measurement

        # Innovation (measurement residual)
        y = z - self.H @ self.x

        # Innovation covariance
        S = self.H @ self.P @ self.H.T + self.R

        # Kalman gain
        K = self.P @ self.H.T @ np.linalg.inv(S)

        # Corrected state & covariance
        self.x = self.x + K @ y
        I = np.eye(self.P.shape[0])
        self.P = (I - K @ self.H) @ self.P

        # Metadata
        self.time_since_update = 0
        self.hits += 1
        self.hit_streak += 1
        self.confidence = confidence

        # Class stabilization: if class_id is -1 (low-confidence label),
        # keep the existing class from track history instead of overwriting.
        if class_id >= 0:
            self.class_id = class_id
            self.class_history.append(class_id)
            if len(self.class_history) > 20:
                self.class_history.pop(0)
        # else: keep self.class_id unchanged (use historical majority)

        # History
        self.confidence_history.append(confidence)
        if len(self.confidence_history) > 10:
            self.confidence_history.pop(0)
        self.bbox_history.append(np.asarray(bbox))
        if len(self.bbox_history) > 10:
            self.bbox_history.pop(0)

    # ── Convenience ──────────────────────────────────────────────────────

    def get_bbox(self) -> np.ndarray:
        """Return current estimated [x1, y1, x2, y2]."""
        return _z_to_bbox(self.x)

    def get_centroid(self) -> Tuple[float, float]:
        """Return current estimated (cx, cy)."""
        return (float(self.x[0]), float(self.x[1]))

    def get_velocity(self) -> Tuple[float, float]:
        """Return current estimated (vx, vy) in pixels/frame."""
        return (float(self.x[4]), float(self.x[5]))

    def avg_confidence(self) -> float:
        if not self.confidence_history:
            return self.confidence
        return float(np.mean(self.confidence_history))

    def stable_class_id(self) -> int:
        """Return the most common class_id from recent history (majority vote)."""
        if not self.class_history:
            return self.class_id
        counts: Dict[int, int] = {}
        for c in self.class_history:
            counts[c] = counts.get(c, 0) + 1
        return max(counts, key=counts.get)


# ─────────────────────────────────────────────────────────────────────────────
# TrackedObject compatibility shim
# ─────────────────────────────────────────────────────────────────────────────
# fish_counter.py and the visualization helpers reference TrackedObject fields.
# This shim wraps KalmanTrack so nothing breaks downstream.

@dataclass
class TrackedObject:
    """
    Lightweight view of a KalmanTrack for the counting / drawing layer.
    Re-created each frame from the KalmanTrack state so the drawing
    code does not need to know about Kalman internals.
    """
    object_id: int
    centroid: Tuple[float, float]
    raw_centroid: Tuple[float, float]
    bbox: Tuple[int, int, int, int]
    confidence: float = 0.0
    class_id: int = 0
    disappeared: int = 0
    age: int = 0
    crossed: bool = False
    zone: str = 'unknown'
    last_zone: str = 'unknown'
    confidence_history: List[float] = field(default_factory=list)
    centroid_history: List[Tuple[float, float]] = field(default_factory=list)
    box_sizes: List[Tuple[int, int]] = field(default_factory=list)
    last_counted_frame: int = -100_000


def _track_to_obj(t: KalmanTrack) -> TrackedObject:
    """Convert a KalmanTrack to a TrackedObject for downstream use."""
    bb = t.get_bbox()
    x1, y1, x2, y2 = int(bb[0]), int(bb[1]), int(bb[2]), int(bb[3])
    cx, cy = t.get_centroid()
    return TrackedObject(
        object_id=t.id,
        centroid=(cx, cy),
        raw_centroid=(cx, cy),
        bbox=(x1, y1, x2, y2),
        confidence=t.confidence,
        class_id=t.stable_class_id(),
        disappeared=t.time_since_update,
        age=t.age,
        crossed=t.crossed,
        zone=t.zone,
        last_zone=t.last_zone,
        confidence_history=list(t.confidence_history),
        last_counted_frame=t.last_counted_frame,
    )


# ─────────────────────────────────────────────────────────────────────────────
# KalmanSortTracker — drop-in replacement for CentroidTracker
# ─────────────────────────────────────────────────────────────────────────────

class KalmanSortTracker:
    """
    SORT-style multi-object tracker with Kalman filter prediction.

    This is a drop-in replacement for `CentroidTracker`.  It exposes
    the same public interface (`update`, `update_zones`,
    `get_crossing_candidates`, `mark_counted`, `get_active_tracks`,
    `reset`) so `fish_counter.py` works without structural changes.

    Key differences from CentroidTracker
    -------------------------------------
    ╔══════════════════════╦═══════════════════════╦═══════════════════════╗
    ║ Feature              ║ CentroidTracker       ║ KalmanSortTracker     ║
    ╠══════════════════════╬═══════════════════════╬═══════════════════════╣
    ║ Motion model         ║ None (static)         ║ Constant-velocity KF  ║
    ║ Position on miss     ║ Frozen at last pos    ║ Predicted forward     ║
    ║ Matching metric      ║ Euclidean distance    ║ IoU on bounding boxes ║
    ║ Assignment solver    ║ Greedy                ║ Hungarian (optimal)   ║
    ║ Velocity estimation  ║ No                    ║ Yes (vx, vy)          ║
    ║ Camera-shake robust  ║ Fragile               ║ Robust (KF absorbs)   ║
    ║ Fast-fish handling   ║ Track lost easily     ║ Predicted across gap  ║
    ╚══════════════════════╩═══════════════════════╩═══════════════════════╝

    Parameters
    ----------
    max_age : int
        Maximum frames a track is kept alive without a matched
        detection.  Higher values handle longer occlusions but
        risk ghost tracks.  Recommended: 8–20 for fish at 30fps.
    min_hits : int
        Minimum consecutive matched frames before a track is
        considered *confirmed*.  Prevents one-frame false positives
        from producing counts.  Recommended: 2–3.
    iou_threshold : float
        Minimum IoU between a predicted box and a detection for
        them to be considered a match.  Lower values tolerate more
        movement between frames but risk cross-matching.
        Recommended: 0.20–0.35 for fast fish.
    """

    def __init__(
        self,
        max_age: int = 12,
        min_hits: int = 2,
        iou_threshold: float = 0.25,
    ):
        self.max_age = max_age
        self.min_hits = min_hits
        self.iou_threshold = iou_threshold
        self.tracks: List[KalmanTrack] = []
        self.MIN_TRACK_AGE_FOR_COUNT = 3  # compat with CentroidTracker

    def reset(self) -> None:
        """Clear all tracks and reset the ID counter."""
        self.tracks.clear()
        KalmanTrack._count = 0

    # ── Core update (called every detection frame) ───────────────────────

    def update(
        self,
        detections: List[Tuple[Tuple[int, int, int, int], float, int]],
    ) -> Dict[int, TrackedObject]:
        """
        Run one cycle of predict → match → update → create / prune.

        Parameters
        ----------
        detections : list of ((x1,y1,x2,y2), confidence, class_id)

        Returns
        -------
        dict  {track_id: TrackedObject}  for all *active* tracks
              (including predicted-only tracks that have no detection
              this frame).
        """
        # ── 1. Predict all existing tracks ───────────────────────────────
        predicted_boxes = []
        for t in self.tracks:
            pred_bb = t.predict()
            predicted_boxes.append(pred_bb)

        # ── 2. Build detection array ─────────────────────────────────────
        det_boxes = []
        det_confs = []
        det_classes = []
        for det in detections:
            bbox, conf = det[0], det[1]
            cls_id = det[2] if len(det) > 2 else 0
            det_boxes.append(list(bbox))
            det_confs.append(conf)
            det_classes.append(cls_id)

        # ── 3. Associate detections to tracks (IoU + Hungarian) ──────────
        matched, unmatched_dets, unmatched_trks = self._associate(
            det_boxes, predicted_boxes,
        )

        # ── 4. Update matched tracks ────────────────────────────────────
        for d_idx, t_idx in matched:
            self.tracks[t_idx].update(
                np.array(det_boxes[d_idx]),
                det_confs[d_idx],
                det_classes[d_idx],
            )

        # ── 5. Create new tracks for unmatched detections ────────────────
        for d_idx in unmatched_dets:
            trk = KalmanTrack(
                np.array(det_boxes[d_idx]),
                det_confs[d_idx],
                det_classes[d_idx],
            )
            self.tracks.append(trk)

        # ── 6. Prune dead tracks ─────────────────────────────────────────
        self.tracks = [
            t for t in self.tracks
            if t.time_since_update <= self.max_age
        ]

        # ── 7. Build output dict ─────────────────────────────────────────
        return {t.id: _track_to_obj(t) for t in self.tracks}

    # ── Association logic ────────────────────────────────────────────────

    def _associate(
        self,
        det_boxes: List[list],
        pred_boxes: List[np.ndarray],
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Match detections to predicted track boxes using IoU.

        Returns (matched_pairs, unmatched_det_indices, unmatched_trk_indices).
        """
        num_det = len(det_boxes)
        num_trk = len(pred_boxes)

        if num_trk == 0:
            return [], list(range(num_det)), []
        if num_det == 0:
            return [], [], list(range(num_trk))

        det_arr = np.array(det_boxes, dtype=float)
        trk_arr = np.array([b for b in pred_boxes], dtype=float).reshape(-1, 4)

        iou_matrix = _iou_batch(det_arr, trk_arr)  # (N_det, N_trk)

        # Solve assignment (minimise cost = 1 − IoU)
        if min(num_det, num_trk) > 0:
            cost = 1.0 - iou_matrix
            row_ind, col_ind = solve_assignment(cost)
        else:
            row_ind, col_ind = np.array([], dtype=int), np.array([], dtype=int)

        matched = []
        unmatched_dets = set(range(num_det))
        unmatched_trks = set(range(num_trk))

        for d_idx, t_idx in zip(row_ind, col_ind):
            if iou_matrix[d_idx, t_idx] < self.iou_threshold:
                continue  # IoU too low — treat as unmatched
            matched.append((int(d_idx), int(t_idx)))
            unmatched_dets.discard(int(d_idx))
            unmatched_trks.discard(int(t_idx))

        return matched, sorted(unmatched_dets), sorted(unmatched_trks)

    # ── Zone / crossing API (same interface as CentroidTracker) ──────────

    def update_zones(self, line_y: int, hysteresis: int) -> None:
        """
        Update zone classification for all tracks.

        Zones:
          - 'top'    : centroid above  (line_y − hysteresis/2)
          - 'bottom' : centroid below  (line_y + hysteresis/2)
          - 'middle' : within hysteresis band

        Predicted-only tracks (no detection this frame) still get
        their zone updated because the Kalman filter provides a
        valid centroid estimate.
        """
        upper = line_y - hysteresis // 2
        lower = line_y + hysteresis // 2

        for t in self.tracks:
            _, cy = t.get_centroid()

            if cy < upper:
                new_zone = 'top'
            elif cy > lower:
                new_zone = 'bottom'
            else:
                new_zone = 'middle'

            if new_zone != 'middle':
                if t.zone != 'middle':
                    t.last_zone = t.zone
                t.zone = new_zone
            else:
                t.zone = new_zone

    def get_crossing_candidates(
        self,
        frame_index: int,
        min_crossing_frames: int,
        direction: str = 'down',
    ) -> List[TrackedObject]:
        """
        Return tracks that just crossed the counting line.

        A track crosses when:
          1. last_zone → zone matches the requested direction
          2. Track has enough hits (≥ min_hits) — confirmed track
          3. Track age ≥ MIN_TRACK_AGE_FOR_COUNT
          4. Enough frames since last count for this track

        Because predicted tracks update zones, a fish can be
        counted even if YOLO missed it at the crossing moment.
        """
        candidates = []
        for t in self.tracks:
            # Must be a confirmed track (enough consecutive hits)
            if t.hits < self.min_hits:
                continue
            if t.age < self.MIN_TRACK_AGE_FOR_COUNT:
                continue

            if direction == 'down':
                crossed = t.last_zone == 'top' and t.zone == 'bottom'
            else:
                crossed = t.last_zone == 'bottom' and t.zone == 'top'

            if crossed and (frame_index - t.last_counted_frame >= min_crossing_frames):
                candidates.append(_track_to_obj(t))
        return candidates

    def mark_counted(self, obj: TrackedObject, frame_index: int) -> None:
        """Mark the underlying KalmanTrack as counted."""
        for t in self.tracks:
            if t.id == obj.object_id:
                t.crossed = True
                t.last_counted_frame = frame_index
                break

    def get_active_tracks(self) -> Dict[int, TrackedObject]:
        """Return all tracks that have been confirmed (hits ≥ min_hits)."""
        return {
            t.id: _track_to_obj(t)
            for t in self.tracks
            if t.hits >= self.min_hits or t.time_since_update == 0
        }

    def get_track_count(self) -> int:
        return len(self.tracks)

    # ── Predict-only step (for skipped frames) ───────────────────────────

    def predict_only(self) -> Dict[int, TrackedObject]:
        """
        Run Kalman predict on all tracks *without* any detections.

        Call this on frames where YOLO detection is skipped (frame-skip
        optimisation).  Tracks will advance their position using the
        velocity model and zone updates will still work — meaning fish
        can be counted even on skipped frames.

        Returns
        -------
        dict  {track_id: TrackedObject}
        """
        for t in self.tracks:
            t.predict()
        return {t.id: _track_to_obj(t) for t in self.tracks}

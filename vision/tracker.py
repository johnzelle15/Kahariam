"""
Centroid-Based Object Tracker for Fish Counting

This module provides a lightweight centroid tracker optimized for:
- Edge devices (Raspberry Pi 5)
- Real-time fish detection and counting
- Smooth tracking with reduced flickering

Key Features:
- Exponential Moving Average (EMA) smoothing for stable centroids
- Confidence history tracking to filter flickering detections
- Box size consistency checking to avoid false positives
- Track age management for reliable counting

Author: Fish Counter Project
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


@dataclass
class TrackedObject:
    """
    Represents a single tracked fish with smoothed position and history.
    
    Attributes:
        object_id: Unique identifier for this tracked object
        centroid: Current smoothed (x, y) centroid position
        raw_centroid: Unsmoothed centroid from latest detection
        bbox: Current bounding box (x1, y1, x2, y2)
        confidence: Detection confidence score
        disappeared: Number of consecutive frames without detection
        age: Total number of frames this object has been tracked
        crossed: Whether this object has crossed the counting line
        zone: Current zone relative to counting line ('top', 'middle', 'bottom')
        last_zone: Previous stable zone
        confidence_history: Rolling history of confidence scores
        centroid_history: Rolling history of centroid positions for smoothing
        box_sizes: History of bounding box sizes for consistency checking
        last_counted_frame: Frame index when this object was last counted
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
    last_counted_frame: int = -100000


class CentroidTracker:
    """
    Lightweight centroid-based tracker optimized for Raspberry Pi 5.
    
    This tracker provides:
    - Object ID assignment and persistence across frames
    - EMA smoothing to reduce jitter in centroid positions
    - Confidence averaging to filter out flickering detections
    - Box size consistency checking to improve tracking reliability
    
    Virtual Line Counting Logic:
    ---------------------------
    The tracker divides the frame into three zones based on the counting line:
    
        Top Zone      |  center_y < line_y - hysteresis/2
        ─────────────────────────────────────────────────
        Middle Zone   |  within hysteresis band
        ═══════════════ COUNTING LINE ═══════════════════
        Middle Zone   |  within hysteresis band
        ─────────────────────────────────────────────────
        Bottom Zone   |  center_y > line_y + hysteresis/2
    
    A fish is counted when:
    1. It was previously in the 'top' zone (last_zone == 'top')
    2. It moves to the 'bottom' zone (current zone == 'bottom')
    3. Sufficient frames have passed since last count (prevents double-counting)
    4. The track has existed for minimum number of frames (prevents false counts)
    
    Performance Optimizations:
    -------------------------
    - Uses numpy vectorized operations for distance calculations
    - Limits history sizes to prevent memory growth
    - Efficient OrderedDict for track management
    - Early exit conditions to reduce unnecessary computation
    """
    
    # ─────────────────────────────────────────────────────────────────────────
    # Configuration Constants
    # ─────────────────────────────────────────────────────────────────────────
    
    MAX_DISAPPEARED = 15        # Frames before removing a lost track
    MAX_DISTANCE = 100.0        # Maximum pixel distance for centroid matching
    EMA_ALPHA = 0.4             # Smoothing factor: 0=more smooth, 1=no smoothing
    CONFIDENCE_HISTORY_SIZE = 8 # Number of frames to average confidence
    CENTROID_HISTORY_SIZE = 6   # Number of frames for centroid smoothing
    BOX_SIZE_HISTORY = 5        # Number of frames to check box consistency
    MIN_CONFIDENCE_AVG = 0.3    # Minimum average confidence to keep track
    BOX_SIZE_VARIANCE_MAX = 0.5 # Maximum variance ratio in box sizes
    MIN_TRACK_AGE_FOR_COUNT = 3 # Minimum frames before allowing count
    
    def __init__(
        self,
        max_disappeared: int = MAX_DISAPPEARED,
        max_distance: float = MAX_DISTANCE,
        ema_alpha: float = EMA_ALPHA,
    ):
        """
        Initialize the centroid tracker.
        
        Args:
            max_disappeared: Maximum frames a track can be missing before removal
            max_distance: Maximum distance (pixels) for centroid matching
            ema_alpha: Smoothing factor for EMA (lower = smoother)
        """
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance
        self.ema_alpha = ema_alpha
        
        # Track storage: OrderedDict maintains insertion order for consistent IDs
        self.objects: OrderedDict[int, TrackedObject] = OrderedDict()
        self.next_object_id = 0
        
    def reset(self) -> None:
        """Reset tracker state, clearing all tracks."""
        self.objects.clear()
        self.next_object_id = 0
        
    def register(
        self,
        centroid: Tuple[float, float],
        bbox: Tuple[int, int, int, int],
        confidence: float,
        class_id: int = 0,
    ) -> int:
        """
        Register a new tracked object.
        
        Args:
            centroid: (x, y) center position
            bbox: (x1, y1, x2, y2) bounding box coordinates
            confidence: Detection confidence score
            class_id: Detection class index
            
        Returns:
            Assigned object ID
        """
        obj_id = self.next_object_id
        box_w, box_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        
        self.objects[obj_id] = TrackedObject(
            object_id=obj_id,
            centroid=centroid,
            raw_centroid=centroid,
            bbox=bbox,
            confidence=confidence,
            class_id=class_id,
            confidence_history=[confidence],
            centroid_history=[centroid],
            box_sizes=[(box_w, box_h)],
        )
        
        self.next_object_id += 1
        return obj_id
        
    def deregister(self, object_id: int) -> None:
        """Remove a tracked object by ID."""
        self.objects.pop(object_id, None)
        
    def _compute_smoothed_centroid(
        self,
        new_centroid: Tuple[float, float],
        history: List[Tuple[float, float]],
    ) -> Tuple[float, float]:
        """
        Compute EMA-smoothed centroid position.
        
        Exponential Moving Average Formula:
            smoothed = alpha * new_value + (1 - alpha) * previous_smoothed
        
        This reduces jitter while still responding to actual movement.
        
        Args:
            new_centroid: New raw centroid position
            history: Previous centroid positions
            
        Returns:
            Smoothed (x, y) centroid
        """
        if not history:
            return new_centroid
            
        # Use EMA for smooth tracking
        prev_x, prev_y = history[-1]
        new_x = self.ema_alpha * new_centroid[0] + (1 - self.ema_alpha) * prev_x
        new_y = self.ema_alpha * new_centroid[1] + (1 - self.ema_alpha) * prev_y
        
        return (new_x, new_y)
        
    def _check_box_consistency(self, obj: TrackedObject) -> bool:
        """
        Check if bounding box sizes are consistent (not flickering).
        
        A track with highly variable box sizes may indicate false detections
        or ID switches. This helps filter out unreliable tracks.
        
        Args:
            obj: TrackedObject to check
            
        Returns:
            True if box sizes are consistent, False otherwise
        """
        if len(obj.box_sizes) < 3:
            return True  # Not enough history to judge
            
        sizes = np.array(obj.box_sizes[-self.BOX_SIZE_HISTORY:])
        areas = sizes[:, 0] * sizes[:, 1]
        
        if areas.mean() < 1:
            return False
            
        # Check coefficient of variation (std / mean)
        cv = areas.std() / areas.mean()
        return cv < self.BOX_SIZE_VARIANCE_MAX
        
    def _get_average_confidence(self, obj: TrackedObject) -> float:
        """
        Get rolling average confidence for a tracked object.
        
        Averaging confidence over multiple frames helps identify
        consistently detected objects vs. spurious detections.
        
        Args:
            obj: TrackedObject to check
            
        Returns:
            Average confidence score
        """
        if not obj.confidence_history:
            return obj.confidence
        return np.mean(obj.confidence_history[-self.CONFIDENCE_HISTORY_SIZE:])
        
    def update(
        self,
        detections: List[Tuple[Tuple[int, int, int, int], float, int]],
    ) -> Dict[int, TrackedObject]:
        """
        Update tracker with new detections.
        
        Matching Algorithm:
        ------------------
        1. If no current tracks: register all detections as new tracks
        2. If no new detections: increment disappeared counter for all tracks
        3. Otherwise: compute distance matrix and use greedy matching
        
        Distance matching uses Hungarian-like greedy assignment:
        - Compute pairwise distances between existing centroids and new detections
        - Match closest pairs first (greedy)
        - Register unmatched detections as new tracks
        - Mark unmatched existing tracks as disappeared
        
        Args:
            detections: List of ((x1, y1, x2, y2), confidence, class_id) tuples.
                        class_id is optional for backward compatibility.
            
        Returns:
            Dictionary of object_id -> TrackedObject for all active tracks
        """
        # Handle empty detection case
        if len(detections) == 0:
            # Mark all existing objects as disappeared
            for obj_id in list(self.objects.keys()):
                self.objects[obj_id].disappeared += 1
                if self.objects[obj_id].disappeared > self.max_disappeared:
                    self.deregister(obj_id)
            return self.objects
            
        # Extract centroids from detections
        input_centroids = []
        input_bboxes = []
        input_confs = []
        input_classes = []
        
        for det in detections:
            bbox, conf = det[0], det[1]
            cls_id = det[2] if len(det) > 2 else 0
            x1, y1, x2, y2 = bbox
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            input_centroids.append((cx, cy))
            input_bboxes.append(bbox)
            input_confs.append(conf)
            input_classes.append(cls_id)
            
        input_centroids = np.array(input_centroids)
        
        # If no existing tracks, register all detections
        if len(self.objects) == 0:
            for i in range(len(input_centroids)):
                self.register(
                    tuple(input_centroids[i]),
                    input_bboxes[i],
                    input_confs[i],
                    input_classes[i],
                )
            return self.objects
            
        # Get existing object centroids
        object_ids = list(self.objects.keys())
        object_centroids = np.array([
            self.objects[obj_id].centroid for obj_id in object_ids
        ])
        
        # ─────────────────────────────────────────────────────────────────────
        # Distance Matrix Calculation (Optimized with NumPy)
        # ─────────────────────────────────────────────────────────────────────
        # Compute Euclidean distance between each existing centroid and new detection
        # Using broadcasting for vectorized computation
        
        dist_matrix = np.linalg.norm(
            object_centroids[:, np.newaxis] - input_centroids[np.newaxis, :],
            axis=2,
        )
        
        # ─────────────────────────────────────────────────────────────────────
        # Greedy Matching Algorithm
        # ─────────────────────────────────────────────────────────────────────
        # Sort by distance and match closest pairs first
        
        rows = dist_matrix.min(axis=1).argsort()
        cols = dist_matrix.argmin(axis=1)[rows]
        
        used_rows = set()
        used_cols = set()
        
        for (row, col) in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
                
            # Skip if distance too large
            if dist_matrix[row, col] > self.max_distance:
                continue
                
            # Update matched track
            obj_id = object_ids[row]
            obj = self.objects[obj_id]
            
            new_centroid = tuple(input_centroids[col])
            smoothed = self._compute_smoothed_centroid(new_centroid, obj.centroid_history)
            
            box_w = input_bboxes[col][2] - input_bboxes[col][0]
            box_h = input_bboxes[col][3] - input_bboxes[col][1]
            
            # Update object state
            obj.raw_centroid = new_centroid
            obj.centroid = smoothed
            obj.bbox = input_bboxes[col]
            obj.confidence = input_confs[col]
            obj.class_id = input_classes[col]
            obj.disappeared = 0
            obj.age += 1
            
            # Update histories (with size limits to prevent memory growth)
            obj.confidence_history.append(input_confs[col])
            if len(obj.confidence_history) > self.CONFIDENCE_HISTORY_SIZE:
                obj.confidence_history.pop(0)
                
            obj.centroid_history.append(smoothed)
            if len(obj.centroid_history) > self.CENTROID_HISTORY_SIZE:
                obj.centroid_history.pop(0)
                
            obj.box_sizes.append((box_w, box_h))
            if len(obj.box_sizes) > self.BOX_SIZE_HISTORY:
                obj.box_sizes.pop(0)
                
            used_rows.add(row)
            used_cols.add(col)
            
        # Handle unmatched existing tracks (mark as disappeared)
        for row in range(len(object_ids)):
            if row not in used_rows:
                obj_id = object_ids[row]
                self.objects[obj_id].disappeared += 1
                
                if self.objects[obj_id].disappeared > self.max_disappeared:
                    self.deregister(obj_id)
                    
        # Register unmatched detections as new tracks
        for col in range(len(input_centroids)):
            if col not in used_cols:
                self.register(
                    tuple(input_centroids[col]),
                    input_bboxes[col],
                    input_confs[col],
                    input_classes[col],
                )
                
        # ─────────────────────────────────────────────────────────────────────
        # Prune Low-Quality Tracks
        # ─────────────────────────────────────────────────────────────────────
        # Remove tracks with consistently low confidence or inconsistent boxes
        
        to_remove = []
        for obj_id, obj in self.objects.items():
            if obj.age > 5:  # Only check after some history
                avg_conf = self._get_average_confidence(obj)
                box_ok = self._check_box_consistency(obj)
                
                if avg_conf < self.MIN_CONFIDENCE_AVG or not box_ok:
                    to_remove.append(obj_id)
                    
        for obj_id in to_remove:
            self.deregister(obj_id)
            
        return self.objects
        
    def update_zones(
        self,
        line_y: int,
        hysteresis: int,
    ) -> None:
        """
        Update zone classification for all tracked objects.
        
        Zone Classification:
        -------------------
        - 'top': centroid is above (line_y - hysteresis/2)
        - 'bottom': centroid is below (line_y + hysteresis/2)
        - 'middle': centroid is within the hysteresis band
        
        The hysteresis band prevents rapid zone switching when a fish
        hovers near the line, reducing false counts.
        
        Args:
            line_y: Y-coordinate of the counting line
            hysteresis: Width of the hysteresis band in pixels
        """
        upper = line_y - hysteresis // 2
        lower = line_y + hysteresis // 2
        
        for obj in self.objects.values():
            cy = obj.centroid[1]
            
            if cy < upper:
                new_zone = 'top'
            elif cy > lower:
                new_zone = 'bottom'
            else:
                new_zone = 'middle'
                
            # Only update last_zone when we have a definitive zone
            if new_zone != 'middle':
                if obj.zone != 'middle':
                    obj.last_zone = obj.zone
                obj.zone = new_zone
            else:
                obj.zone = new_zone
                
    def get_crossing_candidates(
        self,
        frame_index: int,
        min_crossing_frames: int,
        direction: str = 'down',
    ) -> List[TrackedObject]:
        """
        Get objects that have just crossed the counting line.
        
        Crossing Detection Logic:
        ------------------------
        An object is considered to have crossed when:
        1. It was in the 'top' zone and is now in 'bottom' zone (direction='down')
        2. Sufficient frames have passed since last count for this object
        3. The track has existed for minimum age (MIN_TRACK_AGE_FOR_COUNT)
        4. The track has consistent box sizes (not flickering)
        
        This multi-condition approach prevents:
        - Double counting from hovering near line
        - False counts from flickering detections
        - Counts from very short-lived tracks (likely false positives)
        
        Args:
            frame_index: Current frame number
            min_crossing_frames: Minimum frames between counts for same object
            direction: 'down' for top-to-bottom, 'up' for bottom-to-top
            
        Returns:
            List of TrackedObjects that crossed the line this frame
        """
        candidates = []
        
        for obj in self.objects.values():
            # Check if object has sufficient history (anti-flicker)
            if obj.age < self.MIN_TRACK_AGE_FOR_COUNT:
                continue
                
            # Check box consistency
            if not self._check_box_consistency(obj):
                continue
                
            # Check crossing direction
            if direction == 'down':
                crossed = (obj.last_zone == 'top' and obj.zone == 'bottom')
            else:
                crossed = (obj.last_zone == 'bottom' and obj.zone == 'top')
                
            if crossed:
                # Check minimum frames since last count
                if frame_index - obj.last_counted_frame >= min_crossing_frames:
                    candidates.append(obj)
                    
        return candidates
        
    def mark_counted(self, obj: TrackedObject, frame_index: int) -> None:
        """
        Mark an object as counted at the given frame.
        
        Args:
            obj: TrackedObject that was counted
            frame_index: Frame number when count occurred
        """
        obj.crossed = True
        obj.last_counted_frame = frame_index
        
    def get_active_tracks(self) -> Dict[int, TrackedObject]:
        """Get all currently active tracks."""
        return dict(self.objects)
        
    def get_track_count(self) -> int:
        """Get number of active tracks."""
        return len(self.objects)

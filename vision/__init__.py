# Fish Counter - Vision/AI modules
"""
Vision module containing:
- CentroidTracker: Lightweight object tracker for fish counting (legacy)
- KalmanSortTracker: SORT-style Kalman filter tracker (recommended)
- TrackedObject: Data class for tracked fish state
"""

from vision.tracker import CentroidTracker, TrackedObject
from vision.kalman_tracker import KalmanSortTracker

__all__ = ['CentroidTracker', 'KalmanSortTracker', 'TrackedObject']

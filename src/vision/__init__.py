# Fish Counter - Vision/AI modules
"""
Vision module containing:
- CentroidTracker: Lightweight object tracker for fish counting
- TrackedObject: Data class for tracked fish state
"""

from src.vision.tracker import CentroidTracker, TrackedObject

__all__ = ['CentroidTracker', 'TrackedObject']

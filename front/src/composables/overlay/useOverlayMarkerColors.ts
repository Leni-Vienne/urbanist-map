import type { OverlayObject, OverlayData, MarkerColor } from '@types';

/**
 * AI : Centralized function to determine marker color based on overlay state
 * This replaces the duplicated logic in multiple files
 */
export function getOverlayMarkerColor(
  overlayData: OverlayObject | OverlayData,
  mode: 'edit' | 'view'
): MarkerColor {
  if (mode === 'edit') {
    if (overlayData.replacesOverlayId) return 'purple'; // Overlay is a replacement for another overlay

    // AI : OverlayData objects are always remote overlays (they come from the backend)
    const isRemoteOverlay = 'savedRemotely' in overlayData ? overlayData.savedRemotely : true;
    const hasBeenModified = 'isModified' in overlayData ? overlayData.isModified : false;
    const isPending = overlayData.status === 'pending';
    const hasPendingChanges = 'hasPendingChanges' in overlayData ? overlayData.hasPendingChanges : false;

    if (!isRemoteOverlay) {
      return 'red'; // Local overlay not saved remotely, meaning brand new
    }

    if (hasBeenModified) return 'orange'; // Remote overlay with unsaved changes
    if (hasPendingChanges) return 'yellow'; // Approved overlay with pending change requests
    if (isPending) return 'yellow'; // Remote overlay awaiting moderation approval
    return 'green'; // Approved overlay, saved and unmodified
  }

  const project = overlayData.project;
  if (!project) return 'grey'; // No associated project

  const { proposalDate, startDate, endDate } = project;

  if (proposalDate && !startDate) return 'yellow'; // Proposed but not started (nor planned)
  if (!startDate) return 'yellow'; // Not yet scheduled

  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (start > now) return 'green'; // Upcoming
  if (end && end <= now) return 'grey'; // Completed
  return 'orange'; // Ongoing
}


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
    // AI : Edit mode color logic based on overlay modification state and status
    if (overlayData.replacesOverlayId) return 'purple'; // Overlay is a replacement for another overlay

    const hasBeenModified = 'isModified' in overlayData ? overlayData.isModified : false;
    const status = overlayData.status;

    // AI : Priority 1: Local modifications (highest priority - shows user they have unsaved work)
    if (hasBeenModified) return 'orange';

    // AI : Priority 2: Pending approval (awaiting moderation)
    if (status === 'pending') return 'yellow';

    // AI : Priority 3: Rejected overlays
    if (status === 'rejected') return 'red';

    // AI : Priority 4: Approved and unmodified
    if (status === 'approved') return 'green';

    // AI : Default: New overlay not yet submitted
    return 'red';
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


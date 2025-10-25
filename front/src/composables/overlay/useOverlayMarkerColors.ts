import type { OverlayObject, OverlayData, MarkerColor, MapMode } from '@types';

/**
 * AI : Centralized function to determine marker color based on overlay state and map mode
 * This replaces the duplicated logic in multiple files
 */
export function getOverlayMarkerColor(
  overlayData: OverlayObject | OverlayData,
  mode: MapMode
): MarkerColor {
  if (mode === 'moderation') {
    // AI : Moderation mode color logic - objective view for review
    const status = overlayData.status;
    const hasPendingChangeRequests = (overlayData.pendingChangeRequestsCount ?? 0) > 0;

    // AI : Pending brand new overlays
    if (status === 'pending') return 'yellow';

    // AI : Approved overlays with pending change requests from users
    if (status === 'approved' && hasPendingChangeRequests) return 'yellow';

    // AI : Approved overlays with no pending changes
    if (status === 'approved') return 'green';

    // AI : Rejected overlays (shouldn't appear in moderation but just in case)
    return 'grey';
  }

  if (mode === 'edit') {
    // AI : Edit mode color logic based on overlay modification state and status
    if (overlayData.replacesOverlayId) return 'purple'; // Overlay is a replacement for another overlay

    const hasBeenModified = 'isModified' in overlayData ? overlayData.isModified : false;
    const isTooBig = 'isTooBig' in overlayData ? overlayData.isTooBig : false;
    const status = overlayData.status;
    // AI : Priority 1: Size validation error (critical issue that prevents submission)
    if (isTooBig) return 'red';

    // AI : Priority 2: Local modifications (shows user they have unsaved work)
    if (hasBeenModified) return 'orange';

    // AI : Priority 3: Pending approval (awaiting moderation)
    if (status === 'pending') return 'yellow';

    // AI : Priority 4: Rejected overlays
    if (status === 'rejected') return 'red';

    // AI : Priority 5: Approved and unmodified
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


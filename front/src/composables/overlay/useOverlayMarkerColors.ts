import type { OverlayObject, OverlayData, MarkerColor, MapMode } from '@types';

/**
 * AI : Centralized function to determine marker color based on overlay state and map mode
 * 
 * This replaces duplicated logic in multiple files. See COLOR_DECISION_TREE.md for
 * detailed flowcharts and explanations of each mode's color logic.
 * 
 * @see front/src/composables/overlay/COLOR_DECISION_TREE.md
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
    const hasPendingChanges = 'hasPendingChanges' in overlayData ? overlayData.hasPendingChanges : false;
    const status = overlayData.status;
    // AI : Priority 1: Size validation error (critical issue that prevents submission)
    if (isTooBig) return 'red';

    // AI : Priority 2: Local modifications (shows user they have unsaved work)
    if (hasBeenModified) return 'orange';

    // AI : Priority 3: Pending change requests (awaiting moderation approval)
    if (hasPendingChanges && status === 'approved') return 'yellow';

    // AI : Priority 4: Pending approval (awaiting moderation)
    if (status === 'pending') return 'yellow';

    // AI : Priority 5: Rejected overlays
    if (status === 'rejected') return 'red';

    // AI : Priority 6: Approved and unmodified
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

/**
 * AI : Debug helper to explain why an overlay has a specific color
 * Useful for troubleshooting color issues
 * 
 * @param overlayData - Overlay data
 * @param mode - Current map mode
 * @returns Explanation of color decision
 * 
 * @example
 * const explanation = explainOverlayColor(overlay, 'edit');
 * console.log(explanation);
 * // "Color: orange (Modified)
 * //  Reason: Overlay has unsaved local changes (isModified = true)
 * //  Mode: edit
 * //  Priority: #3 in edit mode hierarchy"
 */
export function explainOverlayColor(
  overlayData: OverlayObject | OverlayData,
  mode: MapMode
): string {
  const color = getOverlayMarkerColor(overlayData, mode);
  let reason = '';
  let priority = '';

  if (mode === 'moderation') {
    const status = overlayData.status;
    const hasPendingChangeRequests = (overlayData.pendingChangeRequestsCount ?? 0) > 0;

    if (status === 'pending') {
      reason = 'New submission awaiting moderator review';
      priority = '#1';
    } else if (status === 'approved' && hasPendingChangeRequests) {
      reason = `Approved overlay with ${overlayData.pendingChangeRequestsCount} pending change request(s) from users`;
      priority = '#2';
    } else if (status === 'approved') {
      reason = 'Approved and clean (no pending work)';
      priority = '#3';
    } else {
      reason = 'Rejected or unknown status';
      priority = '#4';
    }
  } else if (mode === 'edit') {
    if (overlayData.replacesOverlayId) {
      reason = 'This is a replacement overlay';
      priority = '#1';
    } else if ('isTooBig' in overlayData && overlayData.isTooBig) {
      reason = 'Size validation error: overlay exceeds 1km × 1km maximum';
      priority = '#2';
    } else if ('isModified' in overlayData && overlayData.isModified) {
      reason = 'Overlay has unsaved local changes (isModified = true)';
      priority = '#3';
    } else if ('hasPendingChanges' in overlayData && overlayData.hasPendingChanges && overlayData.status === 'approved') {
      reason = 'Approved overlay with pending change requests';
      priority = '#4';
    } else if (overlayData.status === 'pending') {
      reason = 'Awaiting moderator approval';
      priority = '#5';
    } else if (overlayData.status === 'rejected') {
      reason = 'Rejected by moderator';
      priority = '#6';
    } else if (overlayData.status === 'approved') {
      reason = 'Approved and unmodified';
      priority = '#7';
    } else {
      reason = 'New overlay (not yet submitted)';
      priority = '#8';
    }
  } else {
    // View mode - timeline based
    const project = overlayData.project;
    if (!project) {
      reason = 'No associated project';
      return `Color: ${color} (${reason})`;
    }

    const { proposalDate, startDate, endDate } = project;

    if (overlayData.status === 'pending') {
      reason = 'Pending approval (safety check - should not appear in view mode)';
    } else if (proposalDate && !startDate) {
      reason = 'Proposed but not started (no start date set)';
    } else if (!startDate) {
      reason = 'Not yet scheduled (no start date)';
    } else {
      const now = new Date();
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : null;

      if (start > now) {
        reason = `Upcoming (starts ${start.toLocaleDateString()})`;
      } else if (end && end <= now) {
        reason = `Completed (ended ${end.toLocaleDateString()})`;
      } else {
        reason = 'Ongoing construction';
      }
    }
  }

  const colorNames: Record<MarkerColor, string> = {
    'yellow': 'Yellow',
    'green': 'Green',
    'orange': 'Orange',
    'grey': 'Grey',
    'red': 'Red',
    'purple': 'Purple',
    'blue': 'Blue',
    'gold': 'Gold',
    'black': 'Black'
  };

  return `Color: ${colorNames[color]} (${reason})\nMode: ${mode}${priority ? `\nPriority: ${priority} in ${mode} mode hierarchy` : ''}`;
}

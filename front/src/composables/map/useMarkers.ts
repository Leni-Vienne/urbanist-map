// AI : ============================================================================
// AI : MARKER UTILITIES - Icons, colors, and marker updates
// AI : ============================================================================
// AI : Unified marker management combining icon creation, color logic, and marker updates
// AI : ============================================================================

import L from 'leaflet';
import type { MarkerColor, OverlayObject, OverlayData, MapMode } from '@types';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import type { ShallowRef } from 'vue';
import { formatDate } from '@utils/dateFormat';

// AI : ============================================================================
// AI : ICON CREATION
// AI : ============================================================================

// AI : SVG marker configuration
const markerSize = 25;
const markerHeight = Math.round(markerSize * 1.6); // AI : Must match SVG height calculation

// AI : Overlay outline color (blue) - used for all overlay outlines regardless of status
export const OVERLAY_OUTLINE_COLOR = '#007bff';

// AI : Single base color per marker - everything else is generated
export const markerColors: Record<MarkerColor, string> = {
  blue: '#1E90FF',
  green: '#32CD32',
  orange: '#FF8C00',
  red: '#DC143C',
  gold: '#FFD700',
  yellow: '#FFEA00',
  purple: '#9932CC',
  grey: '#A0A0A0',
  black: '#2F2F2F'
};

// AI : Simple functions to generate variants from base color
function lightenColor(color: string, amount: number): string {
  const hex = color.slice(1);
  const num = parseInt(hex, 16);
  let r = (num >> 16) + amount;
  let g = (num >> 8 & 0x00FF) + amount;
  let b = (num & 0x0000FF) + amount;
  r = r > 255 ? 255 : r < 0 ? 0 : r;
  g = g > 255 ? 255 : g < 0 ? 0 : g;
  b = b > 255 ? 255 : b < 0 ? 0 : b;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darkenColor(color: string, amount: number): string {
  return lightenColor(color, -amount);
}

// AI : Simple marker creation - one base color, generate everything else
function createMarkerSVG(color: MarkerColor): string {
  const baseColor = markerColors[color];
  const lightColor = lightenColor(baseColor, 40);
  const darkColor = darkenColor(baseColor, 40);
  const width = markerSize;
  const height = Math.round(markerSize * 1.6);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 50 82" role="img" aria-label="Map pin">
      <defs>
        <!-- Simple gradient for marker body -->
        <linearGradient id="g-${color}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${lightColor}"/>
          <stop offset="55%" stop-color="${baseColor}"/>
          <stop offset="100%" stop-color="${darkColor}"/>
        </linearGradient>
        
        <!-- Shadow gradient -->
        <linearGradient id="shadow-grad-${color}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- Cast shadow (skewed ellipse to the right) -->
      <ellipse cx="38" cy="80" rx="18" ry="6"
               fill="url(#shadow-grad-${color})" transform="rotate(-8 38 80)"/>

      <!-- Pin body with darker contrasting edge -->
      <path d="M25 1
               C38.807 1 50 12.193 50 26
               C50 45 25 81 25 81
               S0 45 0 26
               C0 12.193 11.193 1 25 1Z"
            fill="url(#g-${color})" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />

      <!-- Inner white circle -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>
    </svg>
  `;
}

// AI : Create standalone project marker SVG with basic project icon instead of circle
function createStandaloneProjectMarkerSVG(color: MarkerColor): string {
  const baseColor = markerColors[color];
  const lightColor = lightenColor(baseColor, 40);
  const darkColor = darkenColor(baseColor, 40);
  const width = markerSize;
  const height = Math.round(markerSize * 1.6);

  return `
     <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 52 82" role="img" aria-label="Project marker">
      <defs>
        <!-- Simple gradient for marker body -->
        <linearGradient id="g-${color}-standalone" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${lightColor}"/>
          <stop offset="55%" stop-color="${baseColor}"/>
          <stop offset="100%" stop-color="${darkColor}"/>
        </linearGradient>
        
        <!-- Shadow gradient -->
        <linearGradient id="shadow-grad-${color}-standalone" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="black" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="black" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- Cast shadow (skewed ellipse to the right) -->
      <ellipse cx="38" cy="80" rx="18" ry="6"
               fill="url(#shadow-grad-${color}-standalone)" transform="rotate(-8 38 80)"/>

      <!-- Pin body with darker contrasting edge -->
      <path d="M25 1
               C38.807 1 50 12.193 50 26
               C50 45 25 81 25 81
               S0 45 0 26
               C0 12.193 11.193 1 25 1Z"
            fill="url(#g-${color}-standalone)" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />

      <!-- Inner white circle background -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>

    <!-- House icon bottom-left -->
    <g transform="translate(24,52) scale(1.6)">
        <!-- Roof -->
        <polygon points="10,0 20,10 0,10" fill="black" stroke="white" stroke-width="1.5"/>
        <!-- Body -->
        <rect x="3" y="10" width="14" height="12" fill="black" stroke="white" stroke-width="1.5"/>
        <!-- Door -->
        <rect x="8" y="14" width="4" height="8" fill="white" stroke="white" stroke-width="1"/>
      </g>
    </svg>
  `;
}

// AI : Create SVG icon for Leaflet
export function createColorIcon(color: MarkerColor): L.DivIcon {
  const svgString = createMarkerSVG(color);

  return L.divIcon({
    html: svgString,
    className: 'custom-svg-marker',
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // AI : Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
}

// AI : Create standalone/project marker icon with basic project icon instead of circle
export function createBasicProjectIcon(color: MarkerColor): L.DivIcon {
  const svgString = createStandaloneProjectMarkerSVG(color);

  return L.divIcon({
    html: svgString,
    className: 'custom-svg-marker standalone-marker',
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // AI : Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
}


// AI : Get raw marker SVG string for cursor display
export function getMarkerSvg(color: MarkerColor): string {
  return createStandaloneProjectMarkerSVG(color);
}

// AI : Create button-sized marker SVG using base color
export function createButtonSVG(color: MarkerColor): string {
  const baseColor = markerColors[color];
  const size = 16;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 50 82" role="img" aria-label="Map pin">
      <!-- Pin body -->
      <path d="M25 1
               C38.807 1 50 12.193 50 26
               C50 45 25 81 25 81
               S0 45 0 26
               C0 12.193 11.193 1 25 1Z"
            fill="${baseColor}" stroke="rgba(0,0,0,0.3)" stroke-width="1" />

      <!-- Inner white circle -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>
    </svg>
  `;
}

// AI : ============================================================================
// AI : MARKER COLORS
// AI : ============================================================================

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
    const isViewingApprovedPosition = 'isViewingApprovedPosition' in overlayData ? overlayData.isViewingApprovedPosition : undefined;
    const isLocalUnsubmitted = 'isModified' in overlayData && overlayData.isModified;

    // AI : Local replacement overlays (shouldn't appear in moderation, but for consistency) - show purple
    if (overlayData.replacesOverlayId && isLocalUnsubmitted) return 'purple';

    // AI : Submitted pending replacement overlays - show yellow for better user feedback
    if (status === 'pending' && overlayData.replacesOverlayId && !isLocalUnsubmitted) return 'yellow';

    // AI : Pending brand new overlays
    if (status === 'pending') return 'yellow';

    // AI : User is viewing suggested position of overlay with pending changes
    // AI : Show yellow marker to indicate this is a proposed change under review
    if (status === 'approved' && isViewingApprovedPosition === false) return 'yellow';

    // AI : Approved overlays (with or without pending changes) - show green when viewing approved position
    // AI : The yellow marker only appears when toggling to view the suggested position
    if (status === 'approved') return 'green';

    // AI : Rejected overlays (shouldn't appear in moderation but just in case)
    return 'grey';
  }

  if (mode === 'edit') {
    // AI : Edit mode color logic based on overlay modification state and status
    const hasBeenModified = 'isModified' in overlayData ? overlayData.isModified : false;
    const isTooBig = 'isTooBig' in overlayData ? overlayData.isTooBig : false;
    const hasPendingChanges = 'hasPendingChanges' in overlayData ? overlayData.hasPendingChanges : false;
    // AI : Treat undefined as "viewing approved" (default state before any toggle)
    const isViewingApprovedPosition = 'isViewingApprovedPosition' in overlayData ? overlayData.isViewingApprovedPosition : undefined;
    const status = overlayData.status;

    // AI : Priority 1: Size validation error (only for local overlays - submitted ones passed backend validation)
    if (isTooBig && hasBeenModified) return 'red';

    // AI : Priority 2: Local replacement overlay (before submission) - show purple
    if (overlayData.replacesOverlayId && hasBeenModified && status !== 'approved') return 'purple';

    // AI : Priority 3: Submitted replacement overlay (pending) - show yellow
    if (status === 'pending' && overlayData.replacesOverlayId && !hasBeenModified) return 'yellow';

    // AI : Priority 4: Other local modifications (shows user they have unsaved work)
    if (hasBeenModified) return 'orange';

    // AI : Priority 5: User is viewing approved position of overlay with pending changes
    // AI : Show green marker even though hasPendingChanges is true
    // AI : isViewingApprovedPosition !== false means: explicitly true OR undefined (default/approved)
    if (hasPendingChanges && isViewingApprovedPosition !== false && status === 'approved') return 'green';

    // AI : Priority 6: Pending change requests - viewing suggested position (explicitly set to false)
    // AI : Only show yellow when user explicitly toggled to view suggested position
    if (hasPendingChanges && isViewingApprovedPosition === false && status === 'approved') return 'yellow';

    // AI : Priority 7: Pending approval (awaiting moderation)
    if (status === 'pending') return 'yellow';

    // AI : Priority 8: Rejected overlays
    if (status === 'rejected') return 'red';

    // AI : Priority 9: Approved and unmodified
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
    const isLocalUnsubmitted = 'isModified' in overlayData && overlayData.isModified;

    if (overlayData.replacesOverlayId && isLocalUnsubmitted) {
      reason = 'Local replacement overlay (not yet submitted) - shown as purple';
      priority = '#1';
    } else if (status === 'pending' && overlayData.replacesOverlayId) {
      reason = 'Submitted replacement overlay awaiting moderator review - shown as yellow';
      priority = '#2';
    } else if (status === 'pending') {
      reason = 'New submission awaiting moderator review';
      priority = '#2';
    } else if (status === 'approved' && hasPendingChangeRequests) {
      reason = `Approved overlay with ${overlayData.pendingChangeRequestsCount} pending change request(s) from users`;
      priority = '#3';
    } else if (status === 'approved') {
      reason = 'Approved and clean (no pending work)';
      priority = '#4';
    } else {
      reason = 'Rejected or unknown status';
      priority = '#5';
    }
  } else if (mode === 'edit') {
    const hasBeenModified = 'isModified' in overlayData && overlayData.isModified;

    if ('isTooBig' in overlayData && overlayData.isTooBig && hasBeenModified) {
      reason = 'Size validation error: overlay exceeds 1km × 1km maximum (only checked for local overlays)';
      priority = '#1';
    } else if (overlayData.replacesOverlayId && hasBeenModified && overlayData.status !== 'approved') {
      reason = 'Local replacement overlay (not yet submitted) - shown as purple';
      priority = '#2';
    } else if (overlayData.replacesOverlayId && !hasBeenModified && overlayData.status === 'pending') {
      reason = 'Submitted replacement overlay (awaiting approval) - shown as yellow';
      priority = '#3';
    } else if (hasBeenModified) {
      reason = 'Overlay has unsaved local changes (isModified = true)';
      priority = '#4';
    } else if ('hasPendingChanges' in overlayData && overlayData.hasPendingChanges && overlayData.status === 'approved') {
      reason = 'Approved overlay with pending change requests';
      priority = '#5';
    } else if (overlayData.status === 'pending') {
      reason = 'Awaiting moderator approval';
      priority = '#6';
    } else if (overlayData.status === 'rejected') {
      reason = 'Rejected by moderator';
      priority = '#7';
    } else if (overlayData.status === 'approved') {
      reason = 'Approved and unmodified';
      priority = '#8';
    } else {
      reason = 'New overlay (not yet submitted)';
      priority = '#9';
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
        reason = `Upcoming (starts ${formatDate(start)})`;
      } else if (end && end <= now) {
        reason = `Completed (ended ${formatDate(end)})`;
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

// AI : ============================================================================
// AI : MARKER UPDATES
// AI : ============================================================================

/**
 * AI : Update overlay markers colors for existing markers based on current mode
 * @param overlays - Reference to overlays object
 * @param specificOverlayId - Optional overlay ID to update only one overlay (optimization)
 */
export function updateOverlayMarkersColors(
  overlays: ShallowRef<Record<string, OverlayObject>>,
  specificOverlayId?: string
): void {
  if (overlays?.value == null) return;

  const overlayStore = useOverlayStore();

  // AI : If specific overlay ID provided, only update that one
  if (specificOverlayId) {
    const overlayObject = overlays.value[specificOverlayId];
    if (overlayObject?.marker != null) {
      const markerColor = getOverlayMarkerColor(overlayObject, overlayStore.mode);
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
    return;
  }

  // AI : Otherwise, iterate through all overlay objects that have markers
  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject?.marker != null) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, overlayStore.mode);
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  });
}

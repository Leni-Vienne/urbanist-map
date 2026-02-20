// AI : ============================================================================
// AI : MARKER UTILITIES - Icons, colors, and marker updates
// AI : ============================================================================
// AI : Unified marker management combining icon creation, color logic, and marker updates
// AI : ============================================================================

import L from "leaflet";
import type { MarkerColor, OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import type { ShallowRef } from "vue";
import { getApprovalStatusColor, getTimelineBasedColor } from "@/utils/markerColors";

// AI : ============================================================================
// AI : ICON CREATION
// AI : ============================================================================

// AI : SVG marker configuration
const markerSize = 25;
const markerHeight = Math.round(markerSize * 1.6); // AI : Must match SVG height calculation

// AI : Overlay outline color (blue) - used for all overlay outlines regardless of status
export const OVERLAY_OUTLINE_COLOR = "#007bff";

// AI : Single base color per marker - everything else is generated
export const markerColors: Record<MarkerColor, string> = {
  blue: "#1E90FF",
  green: "#32CD32",
  orange: "#FF8C00",
  red: "#DC143C",
  yellow: "#FFEA00",
  purple: "#9932CC",
  grey: "#A0A0A0",
};

// AI : Simple functions to generate variants from base color
// AI : NOTE: Global SVGs in MapSvgDefs.vue use these colors but compute them locally.
// AI : We keep markerColors export for consistency/reuse.

// AI : Simple marker creation - one base color, generate everything else
// AI : Used for city markers, country markers (generic map markers)
// AI : Simple marker creation - references global defs in MapSvgDefs.vue
function createMarkerSVG(color: MarkerColor): string {
  const width = markerSize;
  const height = Math.round(markerSize * 1.6);

  // AI : References globally defined gradients in MapSvgDefs.vue
  // AI : IDs format: g-[color] and shadow-grad-[color]
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 50 82" role="img" aria-label="Map pin">
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

      <!-- Inner white circle - simple and clean -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>
    </svg>
  `;
}

// AI : Overlay marker with picture frame icon to indicate images/overlays
function createOverlayMarkerSVG(color: MarkerColor): string {
  const width = 32;
  const height = 40;

  return `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 50 82" role="img" aria-label="Map pin">
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

      <!-- Image / Frame icon bottom-left (high-contrast border) -->
      <g transform="translate(24,52) scale(1.6)">
      <svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 24 24">
        <path fill-rule="evenodd" d="M13 10a1 1 0 0 1 1-1h.01a1 1 0 1 1 0 2H14a1 1 0 0 1-1-1Z" clip-rule="evenodd"/>
        <path fill-rule="evenodd" d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12c0 .556-.227 1.06-.593 1.422A.999.999 0 0 1 20.5 20H4a2.002 2.002 0 0 1-2-2V6Zm6.892 12 3.833-5.356-3.99-4.322a1 1 0 0 0-1.549.097L4 12.879V6h16v9.95l-3.257-3.619a1 1 0 0 0-1.557.088L11.2 18H8.892Z" clip-rule="evenodd"/>
      </svg>
    </svg>

  `;
}

// AI : Simple standalone project marker - standard look for projects without overlays
function createStandaloneProjectMarkerSVG(color: MarkerColor): string {
  const width = markerSize;
  const height = Math.round(markerSize * 1.6);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 50 82" role="img" aria-label="Project marker">
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

      <!-- Inner white circle - simple and standard -->
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>
    </svg>
  `;
}

// AI : Create simple SVG icon for Leaflet (city, country markers)
export function createColorIcon(color: MarkerColor): L.DivIcon {
  const svgString = createMarkerSVG(color);

  return L.divIcon({
    html: svgString,
    className: "custom-svg-marker",
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // AI : Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
}

// AI : Create overlay marker icon with picture frame (for overlay markers specifically)
export function createOverlayIcon(color: MarkerColor): L.DivIcon {
  const svgString = createOverlayMarkerSVG(color);

  return L.divIcon({
    html: svgString,
    className: "custom-svg-marker overlay-marker",
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // AI : Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
}

// AI : Create standalone/project marker icon with simple circle (for standalone projects)
export function createStandaloneProjectIcon(color: MarkerColor): L.DivIcon {
  const svgString = createStandaloneProjectMarkerSVG(color);

  return L.divIcon({
    html: svgString,
    className: "custom-svg-marker standalone-marker",
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
 */
export function getOverlayMarkerColor(
  overlayData: OverlayObject | OverlayData,
  mode: AppMode,
): MarkerColor {
  // AI : Extract overlay-specific properties (not present on all overlay types)
  const hasBeenModified = "isModified" in overlayData ? overlayData.isModified : false;
  const isTooBig = "isTooBig" in overlayData ? overlayData.isTooBig : false;
  const hasPendingChanges =
    "hasPendingChanges" in overlayData ? overlayData.hasPendingChanges : false;
  const isViewingApprovedPosition =
    "isViewingApprovedPosition" in overlayData ? overlayData.isViewingApprovedPosition : undefined;
  const isReplacement = Boolean(overlayData.replacesOverlayId);
  const status = overlayData.status;

  // AI : ==================== OVERLAY-SPECIFIC PRIORITY RULES ====================
  // AI : These rules are unique to overlays and don't apply to projects

  // AI : Size validation error (only for local overlays - submitted ones passed backend validation)
  if (mode === "edit" && isTooBig && hasBeenModified) return "red";

  // AI : Local replacement overlay (before submission) - show purple
  if (isReplacement && hasBeenModified && status !== "approved") return "purple";

  // AI : Viewing suggested position of overlay with pending changes - show yellow
  // AI : Default to yellow if pending changes exist and we haven't explicitly selected the approved view
  if (
    (hasPendingChanges || status === "approved") &&
    (isViewingApprovedPosition === false ||
      (isViewingApprovedPosition === undefined && hasPendingChanges))
  ) {
    return "yellow";
  }

  // AI : Pending change requests with approved status - use green (viewing approved position)
  // AI : ONLY when explicitly viewing approved (isViewingApprovedPosition === true)
  if (hasPendingChanges && status === "approved" && isViewingApprovedPosition === true) {
    return "green";
  }

  // AI : ==================== SHARED STATUS-BASED LOGIC ====================
  // AI : Delegate to shared helper for common status/mode combinations

  if (mode === "moderation" || mode === "edit") {
    const statusColor = getApprovalStatusColor(status, mode, {
      isModified: hasBeenModified ?? false,
      isReplacement,
      isLocalUnsubmitted: hasBeenModified ?? false,
    });
    if (statusColor) return statusColor;
  }

  // AI : ==================== VIEW MODE: TIMELINE-BASED COLORS ====================
  // AI : Based on associated project's timeline dates

  const project = overlayData.project;
  if (!project) return "grey"; // No associated project

  // AI : Use shared timeline helper
  return getTimelineBasedColor(project.proposalDate, project.startDate, project.endDate);
}

// AI : ============================================================================
// AI : MARKER UPDATES
// AI : ============================================================================

/**
 * AI : Update overlay markers colors for existing markers based on current mode
 * @param overlays - Reference to overlays object
 * @param mode - Current map mode (passed as parameter for testability and performance)
 * @param specificOverlayId - Optional overlay ID to update only one overlay (optimization)
 */
export function updateOverlayMarkersColors(
  overlays: ShallowRef<Record<string, OverlayObject>>,
  mode: AppMode,
  specificOverlayId?: string,
): void {
  if (overlays?.value === null) return;

  // AI : If specific overlay ID provided, only update that one
  if (specificOverlayId) {
    const overlayObject = overlays.value[specificOverlayId];
    if (overlayObject !== undefined && overlayObject.marker) {
      const markerColor = getOverlayMarkerColor(overlayObject, mode);
      const colorIcon = createOverlayIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
    return;
  }

  // AI : Otherwise, iterate through all overlay objects that have markers
  for (const overlayObject of Object.values(overlays.value)) {
    if (overlayObject.marker) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, mode);
      const colorIcon = createOverlayIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  }
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}

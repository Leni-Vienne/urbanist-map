import L from "leaflet";
import type { MarkerColor, OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { getApprovalStatusColor, getTimelineStatusColor } from "@/utils/markerColors";
import { getMarker } from "@/services/overlay/overlayRenderRegistry";

const markerSize = 25;
const markerHeight = Math.round(markerSize * 1.6); // Must match SVG height calculation

// Single base color per marker - everything else is generated
export const markerColors: Record<MarkerColor, string> = {
  blue: "#1E90FF",
  green: "#32CD32",
  orange: "#FF8C00",
  red: "#DC143C",
  yellow: "#FFEA00",
  purple: "#9932CC",
  grey: "#A0A0A0",
};

// Overlay marker with picture frame icon to indicate images/overlays
function createOverlayMarkerSVG(color: MarkerColor): string {
  const width = 32;
  const height = 40;

  // References globally defined gradients in MapSvgDefs.vue
  // IDs format: g-[color] and shadow-grad-[color]
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

// Simple standalone project marker - standard look for projects without overlays
function createStandaloneProjectMarkerSVG(color: MarkerColor): string {
  const width = markerSize;
  const height = Math.round(markerSize * 1.6);

  // References globally defined gradients in MapSvgDefs.vue
  // IDs format: g-[color] and shadow-grad-[color]
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

// Overlay DivIcon instances are cached (only 7 colors exist) to avoid recreating
// SVG strings and L.divIcon allocations on every render pass.
const overlayIconCache: Partial<Record<MarkerColor, L.DivIcon>> = {};

// Create overlay marker icon with picture frame (for overlay markers specifically)
export function createOverlayIcon(color: MarkerColor): L.DivIcon {
  if (overlayIconCache[color]) {
    return overlayIconCache[color];
  }
  const svgString = createOverlayMarkerSVG(color);
  const icon = L.divIcon({
    html: svgString,
    className: "custom-svg-marker overlay-marker",
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
  overlayIconCache[color] = icon;
  return icon;
}

// Create standalone/project marker icon with simple circle (for standalone projects)
export function createStandaloneProjectIcon(color: MarkerColor): L.DivIcon {
  const svgString = createStandaloneProjectMarkerSVG(color);

  return L.divIcon({
    html: svgString,
    className: "custom-svg-marker standalone-marker",
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
}

// Get raw marker SVG string for cursor display
export function getMarkerSvg(color: MarkerColor): string {
  return createStandaloneProjectMarkerSVG(color);
}

export function getOverlayMarkerColor(
  overlayData: OverlayObject | OverlayData,
  mode: AppMode,
): MarkerColor {
  // Extract overlay-specific properties (not present on all overlay types)
  const hasBeenModified = "isModified" in overlayData ? overlayData.isModified : false;
  const hasPendingChanges =
    "hasPendingChanges" in overlayData ? overlayData.hasPendingChanges : false;
  const isViewingApprovedPosition =
    "isViewingApprovedPosition" in overlayData ? overlayData.isViewingApprovedPosition : undefined;
  const isTooBig = "isTooBig" in overlayData && overlayData.isTooBig === true;
  const isReplacement = Boolean(overlayData.replacesOverlayId);
  const status = overlayData.status;

  // Size validation error: checkOverlaySizeAndWarn only runs on edit events, so isTooBig===true
  // already implies the user resized the overlay (no need to also check hasBeenModified).
  if (mode === "edit" && isTooBig) return "red";

  // Local replacement overlay (before submission)
  if (isReplacement && hasBeenModified && status !== "approved") return "purple";

  // Viewing suggested (pending) position - show yellow only when explicitly toggled
  if (hasPendingChanges && isViewingApprovedPosition === false) {
    return "yellow";
  }

  // Approved overlay with pending changes, viewing approved position (default or explicit)
  if (hasPendingChanges && status === "approved") {
    return "green";
  }

  if (mode === "moderation" || mode === "edit") {
    const statusColor = getApprovalStatusColor(status, mode, {
      isModified: hasBeenModified ?? false,
      isReplacement,
      isLocalUnsubmitted: hasBeenModified ?? false,
    });
    if (statusColor) return statusColor;
  }

  // View mode: color by the project's timeline status
  const project = overlayData.project;
  if (!project) return "grey";

  return getTimelineStatusColor(project.timelineStatus);
}

/**
 * Update overlay marker colors based on current mode.
 * Pass a specific overlay ID to update only that one marker (optimization).
 */
export function updateOverlayMarkersColors(
  overlays: Record<string, OverlayObject>,
  mode: AppMode,
  specificOverlayId?: string,
): void {
  // If specific overlay ID provided, only update that one
  if (specificOverlayId) {
    const overlayObject = overlays[specificOverlayId];
    if (overlayObject) {
      const marker = getMarker(overlayObject.id);
      if (marker) {
        const markerColor = getOverlayMarkerColor(overlayObject, mode);
        const colorIcon = createOverlayIcon(markerColor);
        marker.setIcon(colorIcon);
      }
    }
    return;
  }

  for (const overlayObject of Object.values(overlays)) {
    const marker = getMarker(overlayObject.id);
    if (marker) {
      const markerColor = getOverlayMarkerColor(overlayObject, mode);
      const colorIcon = createOverlayIcon(markerColor);
      marker.setIcon(colorIcon);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}

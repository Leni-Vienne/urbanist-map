import L from "leaflet";
import { watchEffect } from "vue";
import type { MarkerColor, OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { getApprovalStatusColor, getTimelineStatusColor } from "@/utils/markerColors";
import { getMarker } from "@/services/overlay/overlayRenderRegistry";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";

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

// Shared pin silhouette for both marker variants.
const PIN_BODY_PATH =
  "M25 1 C38.807 1 50 12.193 50 26 C50 45 25 81 25 81 S0 45 0 26 C0 12.193 11.193 1 25 1Z";

// Picture-frame glyph that distinguishes overlay markers from plain project markers.
const OVERLAY_FRAME_ICON = `
      <g transform="translate(24,52) scale(1.6)">
        <svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 24 24">
          <path fill-rule="evenodd" d="M13 10a1 1 0 0 1 1-1h.01a1 1 0 1 1 0 2H14a1 1 0 0 1-1-1Z" clip-rule="evenodd"/>
          <path fill-rule="evenodd" d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12c0 .556-.227 1.06-.593 1.422A.999.999 0 0 1 20.5 20H4a2.002 2.002 0 0 1-2-2V6Zm6.892 12 3.833-5.356-3.99-4.322a1 1 0 0 0-1.549.097L4 12.879V6h16v9.95l-3.257-3.619a1 1 0 0 0-1.557.088L11.2 18H8.892Z" clip-rule="evenodd"/>
        </svg>
      </g>`;

interface MarkerSVGOptions {
  width: number;
  height: number;
  // Gradient id suffix: "" for overlay markers, "-standalone" for plain project markers.
  gradientSuffix: string;
  ariaLabel: string;
  innerGlyph?: string;
}

// References gradients defined globally in MapSvgDefs.vue: g-[color][suffix], shadow-grad-[color][suffix].
function buildMarkerSVG(color: MarkerColor, opts: MarkerSVGOptions): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 50 82" role="img" aria-label="${opts.ariaLabel}">
      <ellipse cx="38" cy="80" rx="18" ry="6"
               fill="url(#shadow-grad-${color}${opts.gradientSuffix})" transform="rotate(-8 38 80)"/>
      <path d="${PIN_BODY_PATH}"
            fill="url(#g-${color}${opts.gradientSuffix})" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>${opts.innerGlyph ?? ""}
    </svg>
  `;
}

// Overlay marker with picture frame icon to indicate images/overlays
function createOverlayMarkerSVG(color: MarkerColor): string {
  return buildMarkerSVG(color, {
    width: 32,
    height: 40,
    gradientSuffix: "",
    ariaLabel: "Map pin",
    innerGlyph: OVERLAY_FRAME_ICON,
  });
}

// Simple standalone project marker - standard look for projects without overlays
function createStandaloneProjectMarkerSVG(color: MarkerColor): string {
  return buildMarkerSVG(color, {
    width: markerSize,
    height: markerHeight,
    gradientSuffix: "-standalone",
    ariaLabel: "Project marker",
  });
}

// DivIcon instances are cached per color (only 7 colors exist) to avoid recreating
// SVG strings and L.divIcon allocations on every render pass. Leaflet builds a fresh
// DOM element per marker, so a single DivIcon instance is safe to share.
const overlayIconCache: Partial<Record<MarkerColor, L.DivIcon>> = {};
const standaloneIconCache: Partial<Record<MarkerColor, L.DivIcon>> = {};

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
  const cached = standaloneIconCache[color];
  if (cached) return cached;

  const icon = L.divIcon({
    html: createStandaloneProjectMarkerSVG(color),
    className: "custom-svg-marker standalone-marker",
    iconSize: [markerSize, markerHeight],
    iconAnchor: [markerSize / 2, markerHeight], // Anchor at bottom center (pin tip)
    popupAnchor: [0, -markerHeight],
  });
  standaloneIconCache[color] = icon;
  return icon;
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
    return getApprovalStatusColor(status, mode, {
      isModified: hasBeenModified,
      isReplacement,
    });
  }

  // View mode: color by the project's timeline status
  const project = overlayData.project;
  if (!project) return "grey";

  return getTimelineStatusColor(project.timelineStatus);
}

/**
 * Set up a single watchEffect that keeps every overlay marker's color in sync with its
 * Pinia state (status, isModified, hasPendingChanges, isViewingApprovedPosition, project,
 * isTooBig, replacesOverlayId) and the current map mode. Replaces the imperative
 * updateOverlayMarkersColors call sites; data mutations that go through overlayStore /
 * batchUpdateOverlays / updateOverlay trigger this automatically.
 *
 * Initial color is set by createSingleMarker / createMarker on creation; this effect
 * only handles subsequent changes. The _cmorgColor cache on each marker short-circuits
 * no-op setIcon calls.
 */
export function initializeMarkerColorTriggers(): void {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  watchEffect(() => {
    const mode = mapStore.mode;
    for (const overlayObject of Object.values(overlayStore.overlays)) {
      const marker = getMarker(overlayObject.id);
      if (!marker) continue;
      const color = getOverlayMarkerColor(overlayObject, mode);
      const markerWithColor = marker as L.Marker & { _cmorgColor?: MarkerColor };
      if (markerWithColor._cmorgColor === color) continue;
      marker.setIcon(createOverlayIcon(color));
      markerWithColor._cmorgColor = color;
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}

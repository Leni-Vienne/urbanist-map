import type { Marker as MaplibreMarker } from "maplibre-gl";
import { watchEffect } from "vue";
import type { MarkerColor, OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { getApprovalStatusColor, getTimelineStatusColor } from "@/utils/markerColors";
import { getMarker } from "@/services/overlay/renderRegistry";
import { getOverlayImageCorners } from "@/services/overlay/imageLayer";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { t } from "@/locales";

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

// Overlay status pin as a DOM element for maplibregl.Marker (anchor 'bottom' = pin tip).
// The SVG is rendered at 32x40 to match createOverlayMarkerSVG.
export function createOverlayMarkerElement(color: MarkerColor): HTMLElement {
  const el = document.createElement("div");
  el.className = "custom-svg-marker overlay-marker";
  el.style.width = "32px";
  el.style.height = "40px";
  el.style.cursor = "pointer";
  el.innerHTML = createOverlayMarkerSVG(color);
  el.dataset.cmorgColor = color;
  return el;
}

// Re-render an overlay marker element in a new color, skipping no-op updates.
export function updateOverlayMarkerColor(marker: MaplibreMarker, color: MarkerColor): void {
  const el = marker.getElement();
  if (el.dataset.cmorgColor === color) return;
  el.innerHTML = createOverlayMarkerSVG(color);
  el.dataset.cmorgColor = color;
}

// Standalone project pin as a DOM element for maplibregl.Marker (anchor 'bottom' = pin tip).
export function createStandaloneProjectMarkerElement(color: MarkerColor): HTMLElement {
  const el = document.createElement("div");
  el.className = "custom-svg-marker standalone-marker";
  el.style.width = `${markerSize}px`;
  el.style.height = `${markerHeight}px`;
  el.style.cursor = "pointer";
  el.innerHTML = createStandaloneProjectMarkerSVG(color);
  el.dataset.cmorgColor = color;
  return el;
}

// Re-render a standalone marker element in a new color, skipping no-op updates.
export function updateStandaloneMarkerColor(marker: MaplibreMarker, color: MarkerColor): void {
  const el = marker.getElement();
  if (el.dataset.cmorgColor === color) return;
  el.innerHTML = createStandaloneProjectMarkerSVG(color);
  el.dataset.cmorgColor = color;
}

// Get raw marker SVG string for cursor display
export function getMarkerSvg(color: MarkerColor): string {
  return createStandaloneProjectMarkerSVG(color);
}

/**
 * Update marker color + tooltip based on overlay storage status
 * @param overlayObject - The overlay object to update
 * @param cachedMarkerColor - Optional pre-calculated marker color to avoid redundant computation
 */
export function updateMarkerTooltip(
  overlayObject: OverlayObject,
  cachedMarkerColor?: MarkerColor,
): void {
  const mapStore = useMapStore();
  const marker = getMarker(overlayObject.id);

  if (!marker) return;

  const markerColor = cachedMarkerColor ?? getOverlayMarkerColor(overlayObject, mapStore.mode);
  updateOverlayMarkerColor(marker, markerColor);

  const element = marker.getElement();

  // View mode shows no tooltip; edit & moderation modes do.
  if (mapStore.mode === "view") {
    element.removeAttribute("title");
    return;
  }

  function getTooltipTextForOverlay(): string {
    const hasBeenModified = overlayObject.isModified;
    const hasPendingChanges = overlayObject.hasPendingChanges ?? false;
    const isReplacement = overlayObject.replacesOverlayId !== null;
    const isApproved = overlayObject.status === "approved";
    const isPending = overlayObject.status === "pending";
    const isRejected = overlayObject.status === "rejected";
    const isViewingApprovedPosition = overlayObject.isViewingApprovedPosition;

    // eslint-disable-next-line init-declarations
    let statusText: string;
    let modifierText = "";

    if (isReplacement && !isApproved) {
      statusText = t("markerTooltip.status.replacementOverlay");
    } else if (isPending) {
      statusText = t("markerTooltip.status.pendingApproval");
      if (hasBeenModified) {
        modifierText = t("markerTooltip.modifiers.modified");
      }
    } else if (isApproved) {
      statusText = t("common.approved");
      if (hasPendingChanges && isViewingApprovedPosition === false) {
        modifierText = t("markerTooltip.modifiers.viewingSuggested");
      } else if (hasPendingChanges && isViewingApprovedPosition !== false) {
        modifierText = t("markerTooltip.modifiers.hasPendingChanges");
      } else if (hasBeenModified) {
        modifierText = t("markerTooltip.modifiers.modified");
      }
    } else if (isRejected) {
      statusText = t("markerTooltip.status.rejected");
    } else if (hasBeenModified) {
      statusText = t("markerTooltip.status.localOverlay");
    } else {
      statusText = t("markerTooltip.status.newOverlay");
    }

    return modifierText ? `${statusText} (${modifierText})` : statusText;
  }

  element.title = getTooltipTextForOverlay();
}

/**
 * Update the marker position based on the overlay's current center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  const marker = getMarker(overlayObject.id);
  if (!marker) return;

  // Centroid from the live image corners so the pin tracks the overlay during edits.
  const corners = getOverlayImageCorners(overlayObject.id) ?? overlayObject.corners;
  if (corners.length === 4) {
    const centroid = calculateCentroidFromCorners(corners);
    if (centroid) marker.setLngLat([centroid.lng, centroid.lat]);
  }
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
 * Initial color is set by createOverlayMarker / createMarker on creation; this effect
 * only handles subsequent changes. The _cmorgColor cache on each marker short-circuits
 * no-op setIcon calls.
 */
let markerColorTriggersInitialized = false;

export function initializeMarkerColorTriggers(): void {
  if (markerColorTriggersInitialized) return;
  markerColorTriggersInitialized = true;

  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  watchEffect(() => {
    const mode = mapStore.mode;
    for (const overlayObject of Object.values(overlayStore.overlays)) {
      const marker = getMarker(overlayObject.id);
      if (!marker) continue;
      updateOverlayMarkerColor(marker, getOverlayMarkerColor(overlayObject, mode));
    }
  });
}

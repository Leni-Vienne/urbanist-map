import type { Marker as MaplibreMarker } from "maplibre-gl";
import type { MarkerColor } from "@/types/index";

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
  ariaLabel: string;
  innerGlyph?: string;
}

// The g-[color] and shadow-grad gradients must exist in the document (see MapSvgDefs).
function buildMarkerSVG(color: MarkerColor, opts: MarkerSVGOptions): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 50 82" role="img" aria-label="${opts.ariaLabel}">
      <ellipse cx="38" cy="80" rx="18" ry="6"
               fill="url(#shadow-grad)" transform="rotate(-8 38 80)"/>
      <path d="${PIN_BODY_PATH}"
            fill="url(#g-${color})" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />
      <circle cx="25" cy="25" r="9.5" fill="#ffffff" stroke="#e6f2ff" stroke-width="1"/>${opts.innerGlyph ?? ""}
    </svg>
  `;
}

// Overlay marker with picture frame icon to indicate images/overlays
function createOverlayMarkerSVG(color: MarkerColor): string {
  return buildMarkerSVG(color, {
    width: 32,
    height: 40,
    ariaLabel: "Map pin",
    innerGlyph: OVERLAY_FRAME_ICON,
  });
}

// Project pin marker - standard look for projects without overlays
function createProjectPinSVG(color: MarkerColor): string {
  return buildMarkerSVG(color, {
    width: markerSize,
    height: markerHeight,
    ariaLabel: "Project marker",
  });
}

// Overlay status pin as a DOM element for maplibregl.Marker (anchor 'bottom' = pin tip).
// The SVG is rendered at 32x40 to match createOverlayMarkerSVG.
export function createOverlayMarkerElement(color: MarkerColor): HTMLElement {
  const el = document.createElement("div");
  el.className = "custom-svg-marker";
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

// Project pin marker as a DOM element for maplibregl.Marker (anchor 'bottom' = pin tip).
export function createProjectPinElement(color: MarkerColor): HTMLElement {
  const el = document.createElement("div");
  el.className = "custom-svg-marker";
  el.style.width = `${markerSize}px`;
  el.style.height = `${markerHeight}px`;
  el.style.cursor = "pointer";
  el.innerHTML = createProjectPinSVG(color);
  return el;
}

// Get raw marker SVG string for cursor display
export function getMarkerSvg(color: MarkerColor): string {
  return createProjectPinSVG(color);
}

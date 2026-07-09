import maplibregl from "maplibre-gl";
import { map } from "@/services/core/map";
import {
  getImageHandle,
  getCurrentTransform,
  replaceOverlayImageSource,
  takeGestureOwnership,
  releaseGestureOwnership,
} from "@/services/overlay/mapLayers";
import {
  transformToCorners,
  normToLngLat,
  lngLatToNorm,
  type OverlayTransform,
} from "@/services/overlay/transform";
import { commitOverlayEdit } from "@/services/overlay/history";
import { updateMarkerPosition } from "@/services/overlay/markers";
import { imageRequiresCredentials } from "@/utils/imageUrl";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import type { OverlayObject } from "@/types/index";

type Edge = "top" | "bottom" | "left" | "right";

// Normalized crop window in the overlay's local (un-rotated) frame. u runs left->right along
// width, v runs top->bottom along height. Starts at the full image and can only shrink.
interface CropBounds {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

interface CropSession {
  id: string;
  overlayObject: OverlayObject;
  // The full-image rigid rectangle captured when crop mode opened; the crop frame is expressed
  // relative to this, so the session is reversible until the user confirms.
  baseTransform: OverlayTransform;
  bounds: CropBounds;
  handles: Record<Edge, maplibregl.Marker>;
  svgContainer: SVGSVGElement;
  maskPath: SVGPathElement;
  framePath: SVGPathElement;
  onRender: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_FRAC = 0.05;
const EDGES: Edge[] = ["top", "bottom", "left", "right"];

let session: CropSession | null = null;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// Map a sub-rectangle expressed relative to `base` into the frame `base` itself lives in. Used to
// turn a crop window drawn on the displayed (already-cropped) image back into the original's frame.
function composeRect(base: CropBounds, sub: CropBounds): CropBounds {
  const bw = base.u1 - base.u0;
  const bh = base.v1 - base.v0;
  return {
    u0: base.u0 + sub.u0 * bw,
    u1: base.u0 + sub.u1 * bw,
    v0: base.v0 + sub.v0 * bh,
    v1: base.v0 + sub.v1 * bh,
  };
}

function handleElement(edge: Edge): HTMLElement {
  const el = document.createElement("div");
  const cursor = edge === "top" || edge === "bottom" ? "ns-resize" : "ew-resize";
  el.style.cssText =
    "width:14px;height:14px;background:#fff;border:2px solid #3b82f6;border-radius:2px;" +
    `box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:${cursor};`;
  return el;
}

// Each edge handle sits at the midpoint of its edge of the crop window.
function handleNorm(edge: Edge, b: CropBounds): { u: number; v: number } {
  const midU = (b.u0 + b.u1) / 2;
  const midV = (b.v0 + b.v1) / 2;
  if (edge === "top") return { u: midU, v: b.v0 };
  if (edge === "bottom") return { u: midU, v: b.v1 };
  if (edge === "left") return { u: b.u0, v: midV };
  return { u: b.u1, v: midV };
}

function positionHandles(): void {
  if (!session) return;
  for (const edge of EDGES) {
    const { u, v } = handleNorm(edge, session.bounds);
    const ll = normToLngLat(session.baseTransform, u, v);
    session.handles[edge].setLngLat([ll.lng, ll.lat]);
  }
}

function ring(points: { x: number; y: number }[]): string {
  /* oxlint-disable no-non-null-assertion */
  return (
    `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y} ` +
    `L ${points[2]!.x} ${points[2]!.y} L ${points[3]!.x} ${points[3]!.y} Z`
  );
  /* oxlint-enable no-non-null-assertion */
}

// Redraw the dim mask (full footprint minus the crop window, via even-odd fill) and the crop
// frame outline. Hidden below the overlay zoom threshold, matching the image's own visibility.
function syncCrop(): void {
  if (!session) return;
  const mlMap = map.value;
  const threshold = getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  const visible = mlMap.getZoom() >= threshold;
  session.svgContainer.style.display = visible ? "block" : "none";
  for (const edge of EDGES) {
    const el = session.handles[edge].getElement();
    el.style.display = visible ? "block" : "none";
  }
  if (!visible) return;

  const t = session.baseTransform;
  const { u0, u1, v0, v1 } = session.bounds;
  const footprint: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const cropWindow: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  const fp = footprint.map(([u, v]) => mlMap.project(normToLngLat(t, u, v)));
  const cw = cropWindow.map(([u, v]) => mlMap.project(normToLngLat(t, u, v)));

  session.maskPath.setAttribute("d", `${ring(fp)} ${ring(cw)}`);
  session.framePath.setAttribute("d", ring(cw));
}

function wireHandle(edge: Edge): void {
  const marker = session?.handles[edge];
  if (!marker) return;
  marker.on("drag", () => {
    if (!session) return;
    const { u, v } = lngLatToNorm(
      session.baseTransform,
      marker.getLngLat().lng,
      marker.getLngLat().lat,
    );
    const b = session.bounds;
    if (edge === "top") b.v0 = clamp(v, 0, b.v1 - MIN_FRAC);
    else if (edge === "bottom") b.v1 = clamp(v, b.v0 + MIN_FRAC, 1);
    else if (edge === "left") b.u0 = clamp(u, 0, b.u1 - MIN_FRAC);
    else b.u1 = clamp(u, b.u0 + MIN_FRAC, 1);
    // Snap all handles back to their canonical edge midpoints so each handle only moves along
    // its own axis (the user trims one visible side at a time).
    positionHandles();
    syncCrop();
  });
}

/**
 * Enter crop mode for an overlay: dim everything outside a resizable crop window drawn over the
 * image, with one draggable handle per edge. Mutually exclusive with the edit (resize) handles.
 */
export function showCropHandles(overlayObject: OverlayObject): void {
  const mlMap = map.value;
  // eslint-disable-next-line no-unnecessary-condition
  if (!getImageHandle(overlayObject.id)) return;

  hideCropHandles();

  const baseTransform = getCurrentTransform(overlayObject.id);
  if (!baseTransform) return;

  const bounds: CropBounds = { u0: 0, u1: 1, v0: 0, v1: 1 };

  const svgContainer = document.createElementNS(SVG_NS, "svg");
  svgContainer.style.position = "absolute";
  svgContainer.style.top = "0";
  svgContainer.style.left = "0";
  svgContainer.style.width = "100%";
  svgContainer.style.height = "100%";
  svgContainer.style.pointerEvents = "none";
  svgContainer.style.zIndex = "1";

  const maskPath = document.createElementNS(SVG_NS, "path");
  maskPath.setAttribute("fill", "#000000");
  maskPath.setAttribute("fill-opacity", "0.45");
  maskPath.setAttribute("fill-rule", "evenodd");

  const framePath = document.createElementNS(SVG_NS, "path");
  framePath.setAttribute("stroke", "#3b82f6");
  framePath.setAttribute("stroke-width", "2");
  framePath.setAttribute("fill", "transparent");

  svgContainer.appendChild(maskPath);
  svgContainer.appendChild(framePath);
  mlMap.getCanvasContainer().appendChild(svgContainer);

  function makeHandle(edge: Edge, t: OverlayTransform): maplibregl.Marker {
    const { u, v } = handleNorm(edge, bounds);
    const ll = normToLngLat(t, u, v);
    return new maplibregl.Marker({ element: handleElement(edge), draggable: true })
      .setLngLat([ll.lng, ll.lat])
      .addTo(mlMap);
  }

  const handles: Record<Edge, maplibregl.Marker> = {
    top: makeHandle("top", baseTransform),
    bottom: makeHandle("bottom", baseTransform),
    left: makeHandle("left", baseTransform),
    right: makeHandle("right", baseTransform),
  };

  function onRender(): void {
    syncCrop();
  }
  mlMap.on("render", onRender);

  session = {
    id: overlayObject.id,
    overlayObject,
    baseTransform,
    bounds,
    handles,
    svgContainer,
    maskPath,
    framePath,
    onRender,
  };

  EDGES.forEach(wireHandle);
  // Own the overlay for the whole crop session: the image sits still while the crop window is
  // dragged, and applyCrop swaps it (via replaceOverlayImageSource) before hideCropHandles releases,
  // so the reconciler must not touch it in between.
  takeGestureOwnership(overlayObject.id);
  syncCrop();
}

export function hideCropHandles(): void {
  if (!session) return;
  const mlMap = map.value;
  const s = session;
  session = null;

  releaseGestureOwnership(s.id);
  for (const edge of EDGES) s.handles[edge].remove();

  mlMap.off("render", s.onRender);
  if (s.svgContainer.parentNode) s.svgContainer.parentNode.removeChild(s.svgContainer);
}

// Read the source image into a canvas and return the crop window as a fresh WebP data URL.
// crossOrigin matches the existing credentialed-vs-public rule so pending /uploads images are
// readable; data URLs need no crossOrigin.
async function cropImageToDataUrl(url: string, bounds: CropBounds): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (imageRequiresCredentials(url)) image.crossOrigin = "use-credentials";
    else if (!url.startsWith("data:") && !url.startsWith("blob:")) image.crossOrigin = "anonymous";
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Failed to load image for cropping")));
    image.src = url;
  });

  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const sx = Math.round(bounds.u0 * W);
  const sy = Math.round(bounds.v0 * H);
  const sw = Math.max(1, Math.round((bounds.u1 - bounds.u0) * W));
  const sh = Math.max(1, Math.round((bounds.v1 - bounds.v0) * H));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  // Encode both ways and keep the smaller, mirroring the backend's own lossy-vs-lossless race.
  // Photos compress smallest as lossy webp; diagrams/line-art are both smaller AND artifact-free
  // as lossless PNG (lossy webp rings on sharp edges, irrecoverably, before the backend sees it).
  // Whichever wins is faithful enough that the backend's q90/lossless race produces an optimal
  // final file. Comparing base64 lengths is a fair size proxy (same encoding overhead for both).
  const webp = canvas.toDataURL("image/webp", 0.95);
  const png = canvas.toDataURL("image/png");
  return png.length < webp.length ? png : webp;
}

/**
 * Commit the current crop window: bake the cropped pixels into a new image and shrink the
 * overlay's footprint to the window. Returns false (and leaves the overlay untouched) when the
 * window is still the full image or when the image can't be read.
 */
export async function applyCrop(): Promise<boolean> {
  if (!session) return false;
  const { overlayObject: overlay, baseTransform: t, bounds } = session;
  const { u0, u1, v0, v1 } = bounds;

  if (u0 <= 1e-4 && u1 >= 1 - 1e-4 && v0 <= 1e-4 && v1 >= 1 - 1e-4) {
    return false;
  }

  // Always crop the pristine original (history[0].imageUrl) rather than the currently displayed
  // image, so repeated crops stay a single compression generation from the source instead of
  // re-encoding a re-encode. bounds are relative to the displayed image, which itself shows
  // sourceRect of the original, so compose the two to get the window in the original's frame.
  const sourceUrl = overlay.history[0]?.imageUrl ?? overlay.imageUrl;
  const sourceRect = overlay.history.at(-1)?.cropRect ?? { u0: 0, u1: 1, v0: 0, v1: 1 };
  const originalRect = composeRect(sourceRect, bounds);

  const dataUrl = await cropImageToDataUrl(sourceUrl, originalRect).catch((error: unknown) => {
    console.error("Failed to crop overlay image:", error);
    return null;
  });
  if (!dataUrl) return false;

  const centerLL = normToLngLat(t, (u0 + u1) / 2, (v0 + v1) / 2);
  const newTransform: OverlayTransform = {
    center: { lat: centerLL.lat, lng: centerLL.lng },
    width: (u1 - u0) * t.width,
    height: (v1 - v0) * t.height,
    bearing: t.bearing,
  };
  const newCorners = transformToCorners(newTransform);

  // Swap in the cropped pixels at the shrunk footprint, then record it as a normal history step.
  // The new imageUrl makes the step distinct from the pre-crop one, so undo restores both the
  // original pixels and the original footprint.
  replaceOverlayImageSource(overlay.id, dataUrl, newCorners);
  commitOverlayEdit(overlay.id, originalRect);
  updateMarkerPosition(overlay);

  return true;
}

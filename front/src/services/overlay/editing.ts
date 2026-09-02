import * as registry from "@/services/overlay/mapLayers";
import { mobileAwareFlyTo } from "@/services/core/mapNavigation";
import { createSvgCanvasLayer, createSvgPath } from "@/utils/svgCanvasLayer";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { getMap, getMapOrNull, onStyleSwitch, type StyleSwitchPhase } from "@/services/core/map";
import {
  deriveOverlayFilename,
  getImageHandle,
  setOverlayImageTransform,
  raiseOverlayImage,
} from "@/services/overlay/mapLayers";
import {
  cornersToTransform,
  transformToCorners,
  SIGN,
  type OverlayTransform,
} from "@/services/overlay/transform";
import { updateMarkerPosition } from "@/services/overlay/markers";
import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { validateOverlaySize } from "@shared/overlayValidation";
import type { AppMode } from "@shared/types";

import { t } from "@/locales";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import type { OverlayObject, LatLng } from "@/types/index";
import { createOverlayObject } from "@/utils/typeFactories";
import { openOverlayDetail, whenImageReadyIfSelected } from "@/services/overlay/selection";
import { makeHistoryState, commitOverlayEdit } from "@/services/overlay/history";
import { watch } from "vue";
import { toastWarn } from "@/services/core/toast";
import { resolveOverlayCorners } from "@/services/overlay/data";

// Overlay editing operations

const DEFAULT_OVERLAY_WIDTH_METERS = 100;
const NEW_OVERLAY_ZOOM = 16;

function buildLocalOverlay(id: string, imageUrl: string, projectId: string): OverlayObject {
  return createOverlayObject({
    id,
    filename: deriveOverlayFilename(id, imageUrl),
    projectId,
    authorId: useAuthStore().user?.id ?? null,
    imageUrl,
    status: null,
  });
}

async function loadImageAspect(imageUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const aspect = image.naturalWidth / image.naturalHeight;
      resolve(Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
    });
    image.addEventListener("error", () => resolve(1));
    image.src = imageUrl;
  });
}

function defaultCorners(center: LatLng, aspect: number): LatLng[] {
  return transformToCorners({
    center,
    width: DEFAULT_OVERLAY_WIDTH_METERS,
    height: DEFAULT_OVERLAY_WIDTH_METERS / aspect,
    bearing: 0,
  });
}

export async function createLocalOverlay(
  imageUrl: string,
  projectId: string,
  replacesOverlayId?: string,
): Promise<void> {
  const target = getMap();
  const overlayStore = useOverlayStore();
  const project = useProjectStore().projects[projectId];
  const projectCenter: LatLng | null =
    typeof project?.lat === "number" && typeof project.lng === "number"
      ? { lat: project.lat, lng: project.lng }
      : null;
  const shouldZoom =
    projectCenter !== null &&
    target.getZoom() < getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  const currentCenter = target.getCenter();
  const placementCenter: LatLng = shouldZoom
    ? projectCenter
    : { lat: currentCenter.lat, lng: currentCenter.lng };

  const id = crypto.randomUUID();
  const overlay = buildLocalOverlay(id, imageUrl, projectId);
  if (replacesOverlayId) {
    overlay.replacesOverlayId = replacesOverlayId;
    overlay.caption = t("overlay.replacementCaption", {
      name: overlayStore.liveOverlays[replacesOverlayId]?.caption ?? t("overlay.untitled"),
    });
  }

  if (shouldZoom) {
    mobileAwareFlyTo(placementCenter, NEW_OVERLAY_ZOOM);
  }

  const aspect = await loadImageAspect(imageUrl);
  if (getMapOrNull() !== target) throw new Error("Map closed while creating an overlay");

  const corners = defaultCorners(placementCenter, aspect);
  overlay.baselineCorners = corners;
  overlay.history = [makeHistoryState(corners, overlay.imageUrl)];

  overlayStore.addLocalOverlay(id, overlay);
  openOverlayDetail(id);
}

interface CornerDragState {
  ax: number;
  ay: number;
  sx: number;
  sy: number;
  ar: number;
  didMove: boolean;
}

interface EditSession {
  id: string;
  cornerMarkers: maplibregl.Marker[];
  fillSourceId: string;
  fillLayerId: string;
  cornerDrag: CornerDragState | null;
  onEnter?: () => void;
  onLeave?: () => void;
  onDown?: (e: MapMouseEvent) => void;
  svgContainer?: SVGSVGElement;
  svgPath?: SVGPathElement;
  onRender?: () => void;
  // Set while a surface drag is mid-flight so teardown can detach its transient map listeners
  // and re-enable dragPan immediately instead of waiting for the next mouseup.
  activeSurfaceDrag?: { onMove: (e: MapMouseEvent) => void; onUp: () => void };
}

function getSessionOverlay(editSession: EditSession): OverlayObject | null {
  return useOverlayStore().getOverlayById(editSession.id);
}

// Only one overlay is edited at a time (the selected one).
let session: EditSession | null = null;

function getEditingTransform(overlay: OverlayObject): OverlayTransform | null {
  const transient = registry.getGestureTransform(overlay.id);
  if (transient) return transient;
  const corners = resolveOverlayCorners(overlay);
  return corners ? cornersToTransform(corners) : null;
}

function editSourceId(id: string): string {
  return `overlay-edit-${id}`;
}

function polygonFeature(corners: LatLng[]): Feature<Polygon> {
  const ring = corners.map((c) => [c.lng, c.lat] as [number, number]);
  /* oxlint-disable-next-line no-non-null-assertion */
  ring.push(ring[0]!);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

function cornerHandleElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText =
    "width:16px;height:16px;background:#ff8800;border:2px solid #fff;border-radius:2px;" +
    "box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:grab;";
  // Transparent hit area that overflows the visible to grab it easier. Absolutely positioned so it does not
  // grow the element's box, keeping MapLibre's centering on the corner identical to the visible dot.
  const hitArea = document.createElement("div");
  hitArea.style.cssText = "position:absolute;inset:-9px;";
  el.appendChild(hitArea);
  return el;
}

function syncSvgOutline(): void {
  if (!session?.svgPath) return;
  const mlMap = getMap();
  const overlay = getSessionOverlay(session);
  if (!overlay) return;
  const transform = getEditingTransform(overlay);
  // eslint-disable-next-line no-unnecessary-condition
  if (!transform) return;

  const threshold = getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  const isVisible = mlMap.getZoom() >= threshold;

  if (session.svgContainer) {
    session.svgContainer.style.display = isVisible ? "block" : "none";
  }

  session.cornerMarkers.forEach((marker) => {
    const el = marker.getElement();
    el.style.display = isVisible ? "block" : "none";
  });

  if (!isVisible) return;

  const corners = transformToCorners(transform);
  const [p0, p1, p2, p3] = corners.map((c) => mlMap.project(c));
  if (p0 && p1 && p2 && p3) {
    session.svgPath.setAttribute(
      "d",
      `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`,
    );
  }
}

// Sync the outline/fill polygon and reposition corner markers from the live transform.
// skipCorner leaves the actively-dragged marker on the cursor until dragend.
function refreshEditHandlesGeometry(skipCorner = -1): void {
  if (!session) return;
  const mlMap = getMap();
  const overlay = getSessionOverlay(session);
  if (!overlay) return;
  const transform = getEditingTransform(overlay);
  // eslint-disable-next-line no-unnecessary-condition
  if (!transform) return;

  const corners = transformToCorners(transform);
  void mlMap.getSource<GeoJSONSource>(session.fillSourceId)?.setData(polygonFeature(corners));

  session.cornerMarkers.forEach((marker, i) => {
    if (i === skipCorner) return;
    const corner = corners[i];
    if (corner) marker.setLngLat([corner.lng, corner.lat]);
  });

  syncSvgOutline();
}

function flagSize(overlayObject: OverlayObject, transform: OverlayTransform): void {
  const valid = validateOverlaySize(transformToCorners(transform)).isValid;
  if (overlayObject.isTooBig !== !valid) {
    useOverlayStore().updateOverlayDraft(overlayObject.id, { isTooBig: !valid });
  }
  if (!valid) {
    toastWarn(t("upload.maximumSizeOnMap"), t("upload.overlayTooLarge"));
  }
}

function commitGesture(overlayId: string, transform: OverlayTransform): void {
  const overlayObject = useOverlayStore().getOverlayById(overlayId);
  if (!overlayObject) return;
  const corners = transformToCorners(transform);
  flagSize(overlayObject, transform);
  commitOverlayEdit(overlayObject.id, corners);
  updateMarkerPosition(overlayObject, corners);
  registry.finishGestureOwnership(overlayObject.id, corners);
}

function wireCornerDrag(s: EditSession): void {
  s.cornerMarkers.forEach((marker, i) => {
    marker.on("dragstart", () => {
      const overlayObject = getSessionOverlay(s);
      if (!overlayObject) return;
      const transform = getEditingTransform(overlayObject);
      if (!transform) return;
      registry.takeGestureOwnership(overlayObject.id, transform);
      raiseOverlayImage(overlayObject.id);
      const opposite = transformToCorners(transform)[(i + 2) % 4];
      if (!opposite) return;
      const a = maplibregl.MercatorCoordinate.fromLngLat({ lng: opposite.lng, lat: opposite.lat });
      s.cornerDrag = {
        ax: a.x,
        ay: a.y,
        /* oxlint-disable no-non-null-assertion */
        sx: SIGN[i]![0],
        sy: SIGN[i]![1],
        /* oxlint-enable no-non-null-assertion */
        ar: transform.width / transform.height,
        didMove: false,
      };
    });

    marker.on("drag", () => {
      const overlayObject = getSessionOverlay(s);
      if (!overlayObject) return;
      const drag = s.cornerDrag;
      if (!drag) return;
      const ll = marker.getLngLat();
      const c = maplibregl.MercatorCoordinate.fromLngLat({ lng: ll.lng, lat: ll.lat });

      // Center is the midpoint of the dragged corner and its pinned opposite.
      const centerMc = new maplibregl.MercatorCoordinate((drag.ax + c.x) / 2, (drag.ay + c.y) / 2);
      const center = centerMc.toLngLat();
      const unit = centerMc.meterInMercatorCoordinateUnits();
      const dx = (c.x - drag.ax) / unit;
      const dy = (c.y - drag.ay) / unit;

      // Aspect-locked sizing from the diagonal; bearing from the diagonal angle.
      const diag = Math.hypot(dx, dy);
      const height = Math.max(1, diag / Math.sqrt(drag.ar * drag.ar + 1));
      const phi = Math.atan2(dy, dx);
      const localAngle = Math.atan2(drag.sy, drag.sx * drag.ar);
      const transform: OverlayTransform = {
        center: { lat: center.lat, lng: center.lng },
        width: Math.max(1, drag.ar * height),
        height,
        bearing: ((phi - localAngle) * 180) / Math.PI,
      };

      drag.didMove = true;
      setOverlayImageTransform(overlayObject.id, transform);
      refreshEditHandlesGeometry(i);
      updateMarkerPosition(overlayObject, transformToCorners(transform));
    });

    marker.on("dragend", () => {
      const didMove = s.cornerDrag?.didMove === true;
      s.cornerDrag = null;
      refreshEditHandlesGeometry();
      const transform = registry.getGestureTransform(s.id);
      if (!transform || !didMove) {
        registry.releaseGestureOwnership(s.id);
        return;
      }
      commitGesture(s.id, transform);
    });
  });
}

function wireSurfaceDrag(s: EditSession): void {
  const mlMap = getMap();

  s.onEnter = () => {
    mlMap.getCanvas().style.cursor = "move";
  };
  s.onLeave = () => {
    mlMap.getCanvas().style.cursor = "";
  };
  s.onDown = (e: MapMouseEvent) => {
    e.preventDefault();
    if (s.cornerDrag) return; // Prevent surface drag if a corner is currently being dragged

    // Raise above any sibling images that streamed in since selection, so the image being moved
    // stays on top of others it slides over during the drag.
    const overlayObject = getSessionOverlay(s);
    if (!overlayObject) return;
    const overlayId = overlayObject.id;
    const transform = getEditingTransform(overlayObject);
    if (!transform) return;
    registry.takeGestureOwnership(overlayObject.id, transform);
    raiseOverlayImage(overlayObject.id);
    const start = e.lngLat;
    const startCenter = { lat: transform.center.lat, lng: transform.center.lng };
    mlMap.dragPan.disable();

    let didMove = false;

    function onMove(ev: MapMouseEvent): void {
      if (s.cornerDrag) return; // Prevent conflict

      // Require actual physical movement (threshold) to count as a drag, ignoring subpixel jitter
      const dx = ev.point.x - e.point.x;
      const dy = ev.point.y - e.point.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

      didMove = true;
      const currentTransform = registry.getGestureTransform(overlayId);
      if (!currentTransform) return;
      const newTransform: OverlayTransform = {
        ...currentTransform,
        center: {
          lat: startCenter.lat + (ev.lngLat.lat - start.lat),
          lng: startCenter.lng + (ev.lngLat.lng - start.lng),
        },
      };
      setOverlayImageTransform(overlayId, newTransform);
      refreshEditHandlesGeometry();
      const currentOverlay = getSessionOverlay(s);
      if (currentOverlay) updateMarkerPosition(currentOverlay, transformToCorners(newTransform));
    }

    function onUp(): void {
      mlMap.off("mousemove", onMove);
      mlMap.dragPan.enable();
      s.activeSurfaceDrag = undefined;
      if (didMove) {
        const finalTransform = registry.getGestureTransform(overlayId);
        if (finalTransform) {
          commitGesture(s.id, finalTransform);
        } else {
          registry.releaseGestureOwnership(overlayId);
        }
      } else {
        registry.releaseGestureOwnership(overlayId);
      }
    }

    mlMap.on("mousemove", onMove);
    void mlMap.once("mouseup", onUp);
    s.activeSurfaceDrag = { onMove, onUp };
  };

  mlMap.on("mouseenter", s.fillLayerId, s.onEnter);
  mlMap.on("mouseleave", s.fillLayerId, s.onLeave);
  mlMap.on("mousedown", s.fillLayerId, s.onDown);
}

/**
 * Show editing handles for an overlay: set its rigid transform, then add the outline, a
 * transparent whole-surface drag layer, and 4 aspect-locked corner handles.
 */
export function showEditHandles(overlayObject: OverlayObject): void {
  if (session?.id === overlayObject.id) return;

  const mlMap = getMap();
  const handle = getImageHandle(overlayObject.id);
  // eslint-disable-next-line no-unnecessary-condition
  if (!handle) return;

  hideEditHandles();

  const transform = getEditingTransform(overlayObject);
  if (!transform) return;
  const rectCorners = transformToCorners(transform);

  const fillSourceId = editSourceId(overlayObject.id);
  const fillLayerId = `${fillSourceId}-fill`;

  mlMap.addSource(fillSourceId, { type: "geojson", data: polygonFeature(rectCorners) });
  mlMap.addLayer({
    id: fillLayerId,
    type: "fill",
    source: fillSourceId,
    minzoom: getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS),
    paint: { "fill-color": "#000000", "fill-opacity": 0 },
  });

  const cornerMarkers = rectCorners.map((corner) =>
    new maplibregl.Marker({ element: cornerHandleElement(), draggable: true })
      .setLngLat([corner.lng, corner.lat])
      .addTo(mlMap),
  );

  const svgContainer = createSvgCanvasLayer();

  const svgPath = createSvgPath();
  svgPath.setAttribute("stroke", "#3b82f6");
  svgPath.setAttribute("stroke-width", "2");
  svgPath.setAttribute("fill", "transparent");
  svgContainer.appendChild(svgPath);

  mlMap.getCanvasContainer().appendChild(svgContainer);

  function onRender(): void {
    syncSvgOutline();
  }
  mlMap.on("render", onRender);

  session = {
    id: overlayObject.id,
    cornerMarkers,
    fillSourceId,
    fillLayerId,
    cornerDrag: null,
    svgContainer,
    svgPath,
    onRender,
  };

  wireCornerDrag(session);
  wireSurfaceDrag(session);
  // The map may already be idle and never emit another render event.
  syncSvgOutline();
}

// Re-adds the edit-handle source/layer that setStyle() drops on a basemap switch. The DOM corner
// markers, SVG outline, and layer-scoped drag handlers survive the switch, but those handlers only
// fire while their fill layer exists, so the overlay stays draggable only once the layer is back.
function reattachEditHandlesAfterStyleSwitch(phase: StyleSwitchPhase): void {
  if (phase !== "after") return;
  if (!session) return;
  const mlMap = getMap();
  const overlay = getSessionOverlay(session);
  if (!overlay) return;
  const transform = getEditingTransform(overlay);
  // eslint-disable-next-line no-unnecessary-condition
  if (!transform) return;

  const corners = transformToCorners(transform);

  if (!mlMap.getSource(session.fillSourceId)) {
    mlMap.addSource(session.fillSourceId, { type: "geojson", data: polygonFeature(corners) });
  }
  if (!mlMap.getLayer(session.fillLayerId)) {
    mlMap.addLayer({
      id: session.fillLayerId,
      type: "fill",
      source: session.fillSourceId,
      minzoom: getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS),
      paint: { "fill-color": "#000000", "fill-opacity": 0 },
    });
  }

  refreshEditHandlesGeometry();
}

export function hideEditHandles(): void {
  if (!session) return;
  const mlMap = getMap();
  const s = session;
  session = null;

  s.cornerMarkers.forEach((marker) => marker.remove());

  // Tear down an in-flight surface drag so its mousemove handler stops mutating a dead session
  // and dragPan is restored now rather than on a mouseup that may never reach this overlay.
  if (s.activeSurfaceDrag) {
    mlMap.off("mousemove", s.activeSurfaceDrag.onMove);
    mlMap.off("mouseup", s.activeSurfaceDrag.onUp);
    mlMap.dragPan.enable();
  }

  if (registry.isGestureOwned(s.id)) {
    const overlay = getSessionOverlay(s);
    const corners = overlay ? resolveOverlayCorners(overlay) : null;
    if (corners && overlay) {
      registry.setOverlayImageCorners(s.id, corners);
      updateMarkerPosition(overlay, corners);
    }
    registry.releaseGestureOwnership(s.id);
  }

  if (s.onEnter) mlMap.off("mouseenter", s.fillLayerId, s.onEnter);
  if (s.onLeave) mlMap.off("mouseleave", s.fillLayerId, s.onLeave);
  if (s.onDown) mlMap.off("mousedown", s.fillLayerId, s.onDown);
  if (s.onRender) mlMap.off("render", s.onRender);

  if (s.svgContainer?.parentNode) {
    s.svgContainer.parentNode.removeChild(s.svgContainer);
  }

  mlMap.getCanvas().style.cursor = "";
  if (mlMap.getLayer(s.fillLayerId)) mlMap.removeLayer(s.fillLayerId);
  if (mlMap.getSource(s.fillSourceId)) mlMap.removeSource(s.fillSourceId);
}

/**
 * Converge the edit handles to the (selection, mode) pair: handles exist only for the selected
 * overlay in edit mode. hideEditHandles() no-ops when nothing is shown, and the image may not be
 * on the map yet, so the show is deferred until it is (and re-checks the mode by then).
 */
function syncEditHandles(selectedId: string | null, mode: AppMode): void {
  hideEditHandles();

  if (!selectedId || mode !== "edit") return;

  const overlay = useOverlayStore().liveOverlays[selectedId];
  if (!overlay) return;

  whenImageReadyIfSelected(selectedId, () => {
    if (useUiStore().mode === "edit") showEditHandles(overlay);
  });
}

/** Project the retained selection onto a map once its style and project layers are ready. */
export function syncEditHandlesForCurrentState(): void {
  syncEditHandles(useFocusStore().selectedOverlayId, useUiStore().mode);
}

export function syncEditHandlesForMode(mode: AppMode): void {
  syncEditHandles(useFocusStore().selectedOverlayId, mode);
}

/** Install the map-instance callback the reconciler uses after moving an overlay image. */
export function installEditHandleSync(): () => void {
  return registry.registerEditHandleSync(refreshEditHandlesGeometry);
}

export function watchEditHandles(): () => void {
  const uiStore = useUiStore();
  const focus = useFocusStore();

  const stopSelectionWatch = watch(
    () => focus.selectedOverlayId,
    (selectedId) => {
      syncEditHandles(selectedId, uiStore.mode);
    },
  );
  const stopStyleSwitchWatch = onStyleSwitch(reattachEditHandlesAfterStyleSwitch);

  return function stopEditHandleWatchers(): void {
    stopStyleSwitchWatch();
    stopSelectionWatch();
  };
}

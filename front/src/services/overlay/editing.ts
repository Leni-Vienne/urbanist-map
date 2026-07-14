import * as registry from "@/services/overlay/mapLayers";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import maplibregl, { type GeoJSONSource, type MapMouseEvent, LngLat } from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { map, currentZoomLevel } from "@/services/core/map";
import {
  getImageHandle,
  setOverlayImageTransform,
  getCurrentTransform,
  raiseOverlayImage,
  deriveOverlayFilename,
} from "@/services/overlay/mapLayers";
import {
  transformToCorners,
  cornersToTransform,
  isValidQuad,
  SIGN,
  type OverlayTransform,
} from "@/services/overlay/transform";
import { updateMarkerPosition } from "@/services/overlay/markers";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useMapStore } from "@/stores/mapStore";
import { useFocusStore } from "@/stores/focusStore";
import { useAuthStore } from "@/stores/authStore";
import { validateOverlaySize } from "@shared/overlayValidation";
import { onModeTransition } from "@/services/map/modeTransition";
import { registerOnce } from "@/utils/registerOnce";
import type { AppMode } from "@shared/types";

import { t } from "@/locales";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import type { OverlayObject, LatLng } from "@/types/index";
import { createOverlayObject, createProjectObject } from "@/utils/typeFactories";
import { addOverlayToProjectWithId } from "@/services/project/projectMutations";
import { selectOverlay, whenImageReadyIfSelected } from "@/services/overlay/selection";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { makeHistoryState, commitOverlayEdit } from "@/services/overlay/history";
import { watch } from "vue";
import { toastInfo, toastWarn } from "@/services/core/toast";

// Overlay editing operations

// Helper to create a new overlay object
function createNewOverlayObject(id: string, imageUrl: string, projectId: string): OverlayObject {
  const filename = deriveOverlayFilename(id, imageUrl);
  const authStore = useAuthStore();

  // null = local only, never submitted to backend.
  // Avoid undefined here: the factory promotes undefined to "pending",
  // which then requires authorId === currentUserId to pass visibility checks.
  // null takes the dedicated local-overlay branch in isOverlayVisible and always returns true.
  return createOverlayObject({
    id,
    filename,
    projectId,
    authorId: authStore.user?.id ?? null, // Set to current user's ID
    imageUrl,
    status: null, // null = local only, never submitted
  });
}

// Read an image's aspect ratio (width / height). Falls back to square on failure.
async function loadImageAspect(imageUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener("load", () => {
      resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
    });
    img.addEventListener("error", () => resolve(1));
    img.src = imageUrl;
  });
}

// Place a new overlay as a rectangle centered on the current view, sized from the image aspect.
async function defaultCornersForNewOverlay(imageUrl: string): Promise<LatLng[]> {
  const aspect = await loadImageAspect(imageUrl);
  const center = map.value.getCenter();
  const widthMeters = 100;
  return transformToCorners({
    center: { lat: center.lat, lng: center.lng },
    width: widthMeters,
    height: widthMeters / aspect,
    bearing: 0,
  });
}

/**
 * Add a new overlay to the map
 *
 * @param imageUrl
 * @param projectId
 * @param replacesOverlayId
 * @returns the ID of the newly created overlay
 */
export function addOverlay(
  imageUrl: string,
  projectId: string,
  replacesOverlayId?: string,
): string | undefined {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Only allow adding overlays in edit mode
  if (mapStore.mode !== "edit") {
    return undefined;
  }

  if (!projectId) {
    throw new Error("Project Required: A project must be selected to add an overlay");
  }

  const id = crypto.randomUUID();

  // Create overlay object using proper schema structure
  const overlayObject = createNewOverlayObject(id, imageUrl, projectId);

  // If this is a replacement overlay, set the replacement reference
  if (replacesOverlayId) {
    overlayObject.replacesOverlayId = replacesOverlayId;
    const originalOverlay = overlayStore.liveOverlays[replacesOverlayId];
    overlayObject.caption = t("overlay.replacementCaption", {
      name: originalOverlay?.caption ?? t("overlay.untitled"),
    });
  }

  // Check if we need to zoom in to make overlay visible
  const needsZoom =
    currentZoomLevel.value < getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  const projectStore = useProjectStore();

  // Fall back to userContributions if not found in the main project store
  let project = projectStore.projects[projectId];
  if (!project) {
    const userContribution = projectStore.userContributions[projectId];
    if (userContribution) {
      project = createProjectObject(userContribution);
    }
  }

  async function createAndSetupOverlay() {
    const corners = await defaultCornersForNewOverlay(imageUrl);
    overlayObject.baselineCorners = corners;
    overlayObject.history = [makeHistoryState(corners, overlayObject.imageUrl)];

    overlayStore.addOverlay(id, overlayObject);
    // The reconciler owns the image + marker for the new local overlay, and creates them as soon
    // as the zoom allows.
    registry.scheduleOverlayReconcile();

    // Add to project AFTER storing in overlays to avoid "not found" error.
    addOverlayToProjectWithId(projectId, id);
    selectOverlay(id);
  }

  // If zoom level is too low, zoom to project location first, then create overlay
  if (needsZoom && project && typeof project.lat === "number" && typeof project.lng === "number") {
    const targetZoom = 16;

    // Show toast to inform user about auto-zoom

    toastInfo(t("overlay.zoomInToSeeOverlay"), t("overlay.zoomingToProject"));

    mobileAwareFlyTo(new LngLat(project.lng, project.lat), targetZoom);

    // Wait for zoom to complete before creating overlay
    void map.value.once("zoomend", () => {
      void createAndSetupOverlay();
    });
  } else {
    void createAndSetupOverlay();
  }

  return id;
}

interface CornerDragState {
  ax: number;
  ay: number;
  sx: number;
  sy: number;
  ar: number;
}

interface EditSession {
  id: string;
  overlayObject: OverlayObject;
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

// Only one overlay is edited at a time (the selected one).
let session: EditSession | null = null;

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
  el.className = "overlay-corner-handle";
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
  const mlMap = map.value;
  const transform = getCurrentTransform(session.id);
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
  const mlMap = map.value;
  const transform = getCurrentTransform(session.id);
  // eslint-disable-next-line no-unnecessary-condition
  if (!transform) return;

  const corners = transformToCorners(transform);
  mlMap.getSource<GeoJSONSource>(session.fillSourceId)?.setData(polygonFeature(corners));

  session.cornerMarkers.forEach((marker, i) => {
    if (i === skipCorner) return;
    const corner = corners[i];
    if (corner) marker.setLngLat([corner.lng, corner.lat]);
  });

  syncSvgOutline();
}

function flagSize(overlayObject: OverlayObject): void {
  const transform = getCurrentTransform(overlayObject.id);
  if (!transform) return;
  const valid = validateOverlaySize(transformToCorners(transform)).isValid;
  if (overlayObject.isTooBig !== !valid) {
    useOverlayStore().updateOverlay(overlayObject.id, { isTooBig: !valid });
  }
  if (!valid) {
    toastWarn(t("upload.maximumSizeOnMap"), t("upload.overlayTooLarge"));
  }
}

function wireCornerDrag(s: EditSession): void {
  const overlayObject = s.overlayObject;

  s.cornerMarkers.forEach((marker, i) => {
    marker.on("dragstart", () => {
      registry.takeGestureOwnership(overlayObject.id);
      raiseOverlayImage(overlayObject.id);
      const transform = getCurrentTransform(overlayObject.id);
      if (!transform) return;
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
      };
    });

    marker.on("drag", () => {
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

      setOverlayImageTransform(overlayObject.id, transform);
      refreshEditHandlesGeometry(i);
      updateMarkerPosition(overlayObject);
    });

    marker.on("dragend", () => {
      s.cornerDrag = null;
      refreshEditHandlesGeometry();
      flagSize(overlayObject);
      commitOverlayEdit(overlayObject.id);
      registry.releaseGestureOwnership(overlayObject.id);
    });
  });
}

function wireSurfaceDrag(s: EditSession): void {
  const mlMap = map.value;
  const overlayObject = s.overlayObject;

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
    registry.takeGestureOwnership(overlayObject.id);
    raiseOverlayImage(overlayObject.id);

    const transform = getCurrentTransform(overlayObject.id);
    if (!transform) return;
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
      const currentTransform = getCurrentTransform(overlayObject.id);
      if (!currentTransform) return;
      const newTransform: OverlayTransform = {
        ...currentTransform,
        center: {
          lat: startCenter.lat + (ev.lngLat.lat - start.lat),
          lng: startCenter.lng + (ev.lngLat.lng - start.lng),
        },
      };
      setOverlayImageTransform(overlayObject.id, newTransform);
      refreshEditHandlesGeometry();
      updateMarkerPosition(overlayObject);
    }

    function onUp(): void {
      mlMap.off("mousemove", onMove);
      mlMap.dragPan.enable();
      s.activeSurfaceDrag = undefined;
      if (didMove) {
        flagSize(overlayObject);
        commitOverlayEdit(overlayObject.id);
      }
      registry.releaseGestureOwnership(overlayObject.id);
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
  const mlMap = map.value;
  const handle = getImageHandle(overlayObject.id);
  // eslint-disable-next-line no-unnecessary-condition
  if (!handle) return;

  hideEditHandles();

  // Handles line up with the image as currently rendered; showing them never moves the image.
  let transform = getCurrentTransform(overlayObject.id);
  if (!transform) {
    const corners = resolveOverlayCorners(overlayObject, "image") ?? overlayObject.baselineCorners;
    if (!isValidQuad(corners)) return;
    transform = cornersToTransform(corners);
    setOverlayImageTransform(overlayObject.id, transform);
  }
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

  const svgContainer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgContainer.style.position = "absolute";
  svgContainer.style.top = "0";
  svgContainer.style.left = "0";
  svgContainer.style.width = "100%";
  svgContainer.style.height = "100%";
  svgContainer.style.pointerEvents = "none";
  svgContainer.style.zIndex = "1"; // Above map canvas, below markers

  const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svgPath.setAttribute("stroke", "#3b82f6");
  svgPath.setAttribute("stroke-width", "2");
  svgPath.setAttribute("fill", "transparent");
  svgContainer.appendChild(svgPath);

  mlMap.getCanvasContainer().appendChild(svgContainer);

  function onRender(): void {
    syncSvgOutline();
  }
  mlMap.on("render", onRender);

  // Force an initial sync just in case the map is idle and doesn't fire a render event immediately.
  syncSvgOutline();

  session = {
    id: overlayObject.id,
    overlayObject,
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
}

// Re-adds the edit-handle source/layer that setStyle() drops on a basemap switch. The DOM corner
// markers, SVG outline, and layer-scoped drag handlers survive the switch, but those handlers only
// fire while their fill layer exists, so the overlay stays draggable only once the layer is back.
export function reattachEditHandlesAfterStyleSwitch(): void {
  if (!session) return;
  const mlMap = map.value;
  const transform = getCurrentTransform(session.id);
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
  const mlMap = map.value;
  const s = session;
  session = null;

  s.cornerMarkers.forEach((marker) => marker.remove());

  // Tear down an in-flight surface drag so its mousemove handler stops mutating a dead session
  // and dragPan is restored now rather than on a mouseup that may never reach this overlay.
  if (s.activeSurfaceDrag) {
    mlMap.off("mousemove", s.activeSurfaceDrag.onMove);
    mlMap.off("mouseup", s.activeSurfaceDrag.onUp);
    mlMap.dragPan.enable();
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
    if (useMapStore().mode === "edit") showEditHandles(overlay);
  });
}

function registerEditorTriggers(): void {
  // Let the reconciler refresh the active edit session's handles after it moves an image.
  registry.registerEditHandleSync(refreshEditHandlesGeometry);

  const mapStore = useMapStore();
  const focus = useFocusStore();

  watch(
    () => focus.selectedOverlayId,
    (selectedId) => {
      syncEditHandles(selectedId, mapStore.mode);
    },
    { immediate: true },
  );

  onModeTransition("editHandles", (newMode) => {
    syncEditHandles(focus.selectedOverlayId, newMode);
  });
}

/**
 * The edit-handle show/hide triggers (overlay selection and map mode) and the reconciler's
 * handle-sync callback.
 */
export const initializeEditorTriggers = registerOnce(registerEditorTriggers);

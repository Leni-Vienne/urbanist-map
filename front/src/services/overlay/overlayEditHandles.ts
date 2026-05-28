import maplibregl, { type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { map } from "@/services/core/map";
import { getImageHandle } from "@/services/overlay/overlayRenderRegistry";
import {
  transformToCorners,
  cornersToTransform,
  type OverlayTransform,
} from "@/services/overlay/overlayTransform";
import { setOverlayImageTransform } from "@/services/overlay/overlayImageLayer";
import { getCornersForOverlay, saveToHistory } from "@/services/overlay/overlayHistory";
import { updateMarkerPosition } from "@/services/overlay/overlayMarkers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { validateOverlaySize } from "@shared/overlayValidation";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import type { OverlayObject } from "@/types/index";

type Corner = { lat: number; lng: number };

// Corner local-axis signs, matching overlayTransform's [TL, TR, BR, BL] order.
const SIGN: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

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
  outlineLayerId: string;
  cornerDrag: CornerDragState | null;
  onEnter?: () => void;
  onLeave?: () => void;
  onDown?: (e: MapMouseEvent) => void;
}

// Only one overlay is edited at a time (the selected one).
let session: EditSession | null = null;

function editSourceId(id: string): string {
  return `overlay-edit-${id}`;
}

function polygonFeature(corners: Corner[]): Feature<Polygon> {
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
  return el;
}

// Sync the outline/fill polygon and reposition corner markers from the live transform.
// skipCorner leaves the actively-dragged marker on the cursor until dragend.
function refreshEditHandlesGeometry(skipCorner = -1): void {
  if (!session) return;
  const mlMap = map.value;
  const handle = getImageHandle(session.id);
  if (!mlMap || !handle) return;

  const corners = transformToCorners(handle.transform);
  mlMap.getSource<GeoJSONSource>(session.fillSourceId)?.setData(polygonFeature(corners));

  session.cornerMarkers.forEach((marker, i) => {
    if (i === skipCorner) return;
    const corner = corners[i];
    if (corner) marker.setLngLat([corner.lng, corner.lat]);
  });
}

export function refreshEditHandles(): void {
  refreshEditHandlesGeometry();
}

function flagSize(overlayObject: OverlayObject): void {
  const handle = getImageHandle(overlayObject.id);
  if (!handle) return;
  const valid = validateOverlaySize(transformToCorners(handle.transform)).isValid;
  if (overlayObject.isTooBig !== !valid) {
    overlayObject.isTooBig = !valid;
    useOverlayStore().updateOverlay(overlayObject.id, { isTooBig: !valid });
  }
  if (!valid) {
    useToast().add({
      severity: "warn",
      summary: t("upload.overlayTooLarge"),
      detail: t("upload.maximumSizeOnMap"),
      life: 3000,
    });
  }
}

function wireCornerDrag(s: EditSession): void {
  const overlayObject = s.overlayObject;

  s.cornerMarkers.forEach((marker, i) => {
    marker.on("dragstart", () => {
      const handle = getImageHandle(overlayObject.id);
      if (!handle) return;
      const opposite = transformToCorners(handle.transform)[(i + 2) % 4];
      if (!opposite) return;
      const a = maplibregl.MercatorCoordinate.fromLngLat({ lng: opposite.lng, lat: opposite.lat });
      s.cornerDrag = {
        ax: a.x,
        ay: a.y,
        /* oxlint-disable no-non-null-assertion */
        sx: SIGN[i]![0],
        sy: SIGN[i]![1],
        /* oxlint-enable no-non-null-assertion */
        ar: handle.transform.width / handle.transform.height,
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
      saveToHistory(overlayObject);
    });
  });
}

function wireSurfaceDrag(s: EditSession): void {
  const mlMap = map.value;
  if (!mlMap) return;
  const overlayObject = s.overlayObject;

  s.onEnter = () => {
    mlMap.getCanvas().style.cursor = "move";
  };
  s.onLeave = () => {
    mlMap.getCanvas().style.cursor = "";
  };
  s.onDown = (e: MapMouseEvent) => {
    e.preventDefault();
    const handle = getImageHandle(overlayObject.id);
    if (!handle) return;
    const start = e.lngLat;
    const startCenter = { lat: handle.transform.center.lat, lng: handle.transform.center.lng };
    mlMap.dragPan.disable();

    function onMove(ev: MapMouseEvent): void {
      const current = getImageHandle(overlayObject.id);
      if (!current) return;
      const transform: OverlayTransform = {
        ...current.transform,
        center: {
          lat: startCenter.lat + (ev.lngLat.lat - start.lat),
          lng: startCenter.lng + (ev.lngLat.lng - start.lng),
        },
      };
      setOverlayImageTransform(overlayObject.id, transform);
      refreshEditHandlesGeometry();
      updateMarkerPosition(overlayObject);
    }

    function onUp(): void {
      mlMap.off("mousemove", onMove);
      mlMap.dragPan.enable();
      flagSize(overlayObject);
      saveToHistory(overlayObject);
    }

    mlMap.on("mousemove", onMove);
    mlMap.once("mouseup", onUp);
  };

  mlMap.on("mouseenter", s.fillLayerId, s.onEnter);
  mlMap.on("mouseleave", s.fillLayerId, s.onLeave);
  mlMap.on("mousedown", s.fillLayerId, s.onDown);
}

/**
 * Show editing handles for an overlay: rectify its image to the rigid model, then add the
 * outline, a transparent whole-surface drag layer, and 4 aspect-locked corner handles.
 */
export function showEditHandles(overlayObject: OverlayObject): void {
  const mlMap = map.value;
  const handle = getImageHandle(overlayObject.id);
  if (!mlMap || !handle) return;

  hideEditHandles();

  // Rectify so the image corners line up with the handles (skewed overlays snap to a rectangle).
  const corners = getCornersForOverlay(overlayObject) ?? transformToCorners(handle.transform);
  const transform = cornersToTransform(corners);
  setOverlayImageTransform(overlayObject.id, transform);
  const rectCorners = transformToCorners(transform);

  const fillSourceId = editSourceId(overlayObject.id);
  const fillLayerId = `${fillSourceId}-fill`;
  const outlineLayerId = `${fillSourceId}-outline`;

  mlMap.addSource(fillSourceId, { type: "geojson", data: polygonFeature(rectCorners) });
  mlMap.addLayer({
    id: fillLayerId,
    type: "fill",
    source: fillSourceId,
    paint: { "fill-color": "#000000", "fill-opacity": 0 },
  });
  mlMap.addLayer({
    id: outlineLayerId,
    type: "line",
    source: fillSourceId,
    paint: { "line-color": "#3b82f6", "line-width": 2 },
  });

  const cornerMarkers = rectCorners.map((corner) =>
    new maplibregl.Marker({ element: cornerHandleElement(), draggable: true })
      .setLngLat([corner.lng, corner.lat])
      .addTo(mlMap),
  );

  session = {
    id: overlayObject.id,
    overlayObject,
    cornerMarkers,
    fillSourceId,
    fillLayerId,
    outlineLayerId,
    cornerDrag: null,
  };

  wireCornerDrag(session);
  wireSurfaceDrag(session);
}

export function hideEditHandles(): void {
  if (!session) return;
  const mlMap = map.value;
  const s = session;
  session = null;

  s.cornerMarkers.forEach((marker) => marker.remove());

  if (!mlMap) return;
  if (s.onEnter) mlMap.off("mouseenter", s.fillLayerId, s.onEnter);
  if (s.onLeave) mlMap.off("mouseleave", s.fillLayerId, s.onLeave);
  if (s.onDown) mlMap.off("mousedown", s.fillLayerId, s.onDown);
  mlMap.getCanvas().style.cursor = "";
  if (mlMap.getLayer(s.outlineLayerId)) mlMap.removeLayer(s.outlineLayerId);
  if (mlMap.getLayer(s.fillLayerId)) mlMap.removeLayer(s.fillLayerId);
  if (mlMap.getSource(s.fillSourceId)) mlMap.removeSource(s.fillSourceId);
}

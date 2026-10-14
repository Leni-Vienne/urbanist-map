<template>
  <Teleport v-for="pin in pins" :key="pin.data.projectId" :to="pin.element">
    <RenderImagePin
      :data="pin.data"
      :selected="focus.selectedProjectId === pin.data.projectId"
      @open-image="openImage(pin.data)"
      @image-visibility-change="setImageVisibility(pin.data.projectId, $event)"
    />
  </Teleport>
  <ImageLightbox ref="lightbox" />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef, useTemplateRef, watch } from "vue";
import { Marker, type Map as MaplibreMap, type FeatureIdentifier } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { onMapReady } from "@/services/core/map";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { isMobile } from "@/services/core/viewport";
import { decodeRenderImagePin, type RenderImagePinData } from "@/services/map/renderImagePin";
import { imageRequiresCredentials } from "@/utils/imageUrl";
import { useFocusStore } from "@/stores/focusStore";
import { clearHoverPreview } from "@/services/map/hoverPreviewState";
import { PROJECT_SHAPE_QUERY_LAYERS } from "@/services/map/tiles/queryLayers";
import RenderImagePin from "@/components/map/RenderImagePin.vue";
import ImageLightbox from "@/components/common/ImageLightbox.vue";

interface Pin {
  data: RenderImagePinData;
  element: HTMLElement;
  marker: Marker;
  pointTargets: FeatureIdentifier[];
  imageVisible: boolean;
}

const { t } = useI18n();
const focus = useFocusStore();
const pins = shallowRef<Pin[]>([]);
const lightbox = useTemplateRef<InstanceType<typeof ImageLightbox>>("lightbox");
const markers = new Map<string, Pin>();
let target: MaplibreMap | null = null;
let stopWaiting: (() => void) | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

// Keep the circle's hit area for map queries, but hide its paint once the thumbnail loads.
// Feature state also lets the ordinary dot return when both image sources fail.
function setDotsHidden(pin: Pin, hidden: boolean): void {
  const map = target;
  if (!map) return;
  for (const point of pin.pointTargets) {
    if (!map.getSource(point.source)) continue;
    const state: Record<string, unknown> = map.getFeatureState(point);
    if ((state.renderThumbnailVisible === true) !== hidden)
      map.setFeatureState(point, { renderThumbnailVisible: hidden });
  }
}

function releasePointState(pin: Pin): void {
  for (const point of pin.pointTargets) {
    if (target?.getSource(point.source)) target.removeFeatureState(point, "renderThumbnailVisible");
  }
}

function setImageVisibility(projectId: string, visible: boolean): void {
  const pin = markers.get(projectId);
  if (!pin) return;
  pin.imageVisible = visible;
  setDotsHidden(pin, visible);
}

function openImage(data: RenderImagePinData): void {
  clearHoverPreview();
  lightbox.value?.open({
    url: data.imageUrl,
    header: data.name ? `${data.name} — ${t("render.label")}` : t("render.label"),
    crossorigin: imageRequiresCredentials(data.imageUrl) ? "use-credentials" : undefined,
  });
}

function syncPins(): void {
  const map = target;
  if (!map) return;
  const showPins = map.getZoom() >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  const layers = [
    "project-points",
    "pending-project-points",
    ...PROJECT_SHAPE_QUERY_LAYERS,
    ...PROJECT_SHAPE_QUERY_LAYERS.map((id) => `pending-${id}`),
  ].filter((id) => showPins && map.getLayer(id));
  const next = new Map<string, { data: RenderImagePinData; points: FeatureIdentifier[] }>();
  // Rendered queries inherit every layer filter, zoom gate and editor exclusion. Pending
  // features come first in draw order, so a local edit wins over a duplicate approved feature.
  // Below the shared image threshold, leave `next` empty so the normal removal pass
  // tears down thumbnails and restores any ordinary points they covered.
  if (layers.length > 0) {
    for (const feature of map.queryRenderedFeatures(undefined, { layers })) {
      const data = decodeRenderImagePin(feature);
      if (!data) continue;
      // Shape-backed pins use the parent's visibility; only center-point features own a
      // circle to hide. Never hide or otherwise alter the project's vector geometry.
      const points: FeatureIdentifier[] = [];
      if (feature.layer.id === "project-points" || feature.layer.id === "pending-project-points") {
        const point: FeatureIdentifier = {
          source: feature.source,
          id: feature.id ?? data.projectId,
        };
        if (feature.sourceLayer) point.sourceLayer = feature.sourceLayer;
        points.push(point);
      }
      const existing = next.get(data.projectId);
      if (!existing) next.set(data.projectId, { data, points });
      else
        for (const point of points) {
          if (!existing.points.some((entry) => entry.source === point.source))
            existing.points.push(point);
        }
    }
  }
  let changed = false;
  for (const [id, pin] of markers) {
    if (next.has(id)) continue;
    releasePointState(pin);
    pin.marker.remove();
    markers.delete(id);
    changed = true;
  }
  for (const [id, { data, points }] of next) {
    const current = markers.get(id);
    if (current) {
      // A style reload resets feature state even when the thumbnail data stays identical.
      if (
        JSON.stringify(current.data) === JSON.stringify(data) &&
        JSON.stringify(current.pointTargets) === JSON.stringify(points)
      ) {
        setDotsHidden(current, current.imageVisible);
        continue;
      }
      if (current.data.coordinates.join(",") !== data.coordinates.join(","))
        current.marker.setLngLat(data.coordinates);
      releasePointState(current);
      const pin = { ...current, data, pointTargets: points };
      markers.set(id, pin);
      setDotsHidden(pin, pin.imageVisible);
    } else {
      const element = document.createElement("div");
      element.className = "render-image-marker z-2 hover:z-5 focus-within:z-5";
      const marker = new Marker({ element, anchor: "bottom" })
        .setLngLat(data.coordinates)
        .addTo(map);
      markers.set(id, { data, element, marker, pointTargets: points, imageVisible: false });
    }
    changed = true;
  }
  if (changed) pins.value = [...markers.values()];
}

// A render also follows filter, pending-source and style changes. Coalesce animated camera
// frames so the viewport is queried at most once per 120ms, and once after its final frame.
function scheduleSync(): void {
  if (syncTimer !== null) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncPins();
  }, 120);
}

watch(isMobile, scheduleSync);

onMounted(() => {
  stopWaiting = onMapReady((map) => {
    target = map;
    map.on("render", scheduleSync);
    syncPins();
  });
});

onBeforeUnmount(() => {
  stopWaiting?.();
  target?.off("render", scheduleSync);
  if (syncTimer !== null) clearTimeout(syncTimer);
  for (const pin of markers.values()) {
    releasePointState(pin);
    pin.marker.remove();
  }
  markers.clear();
  target = null;
});
</script>

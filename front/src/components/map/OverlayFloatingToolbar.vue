<template>
  <!-- Teleport into the Leaflet marker icon — Leaflet owns pan/zoom positioning -->
  <Teleport :to="markerIconEl" v-if="markerIconEl">
    <div
      class="absolute -translate-x-1/2 -translate-y-[calc(100%+20px)] pointer-events-auto flex flex-col items-center gap-1 font-sans"
      @click.stop
      @mousedown.stop
      @dblclick.stop
      @touchstart.stop
    >
      <div
        class="flex items-center gap-0.5 bg-content-background border border-surface rounded-lg py-1 px-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.2)] whitespace-nowrap"
      >
        <!-- Info toggle -->
        <button
          :title="t('toolbar.info')"
          :class="btnCls({ active: showInfoPopup })"
          @click="toggleInfoPopup"
        >
          <i class="pi pi-ellipsis-v" />
        </button>

        <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />

        <!-- Opacity slider -->
        <input
          type="range"
          min="0"
          max="100"
          :value="opacity"
          @input="onOpacityInput"
          :title="`Opacity: ${opacity}%`"
          class="w-18 h-1 cursor-pointer accent-indigo-600"
        />
        <span class="text-[13px] text-muted-color min-w-7 text-right">{{ opacity }}%</span>

        <!-- Nav prev/next + index -->
        <template v-if="showNav">
          <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />
          <button :title="t('toolbar.previousOverlay')" :class="btnCls()" @click="goToPrevious">
            <i class="pi pi-chevron-left" />
          </button>
          <span v-if="overlayIndex" class="text-[13px] text-muted-color min-w-7 text-center"
            >{{ overlayIndex.current }}/{{ overlayIndex.total }}</span
          >
          <button :title="t('toolbar.nextOverlay')" :class="btnCls()" @click="goToNext">
            <i class="pi pi-chevron-right" />
          </button>
        </template>

        <template v-if="hasCollision">
          <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />
          <button title="Send to back" :class="btnCls()" @click="stackToBack">
            <i class="pi pi-arrow-down" />
          </button>
        </template>

        <!-- Edit-only tools -->
        <template v-if="isEditMode">
          <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />
          <button :title="t('toolbar.undo')" :disabled="!canUndo" :class="btnCls()" @click="undo">
            <i class="pi pi-undo" />
          </button>
          <button v-if="canRedo" :title="t('toolbar.redo')" :class="btnCls()" @click="redo">
            <i class="pi pi-refresh" />
          </button>
          <button
            v-if="canReplaceImage"
            :title="t('toolbar.replace')"
            :class="btnCls()"
            @click="onReplace"
          >
            <i class="pi pi-image" />
          </button>
          <button
            v-if="canDelete"
            :title="t('toolbar.delete')"
            :class="btnCls({ danger: true })"
            @click="onDelete"
          >
            <i class="pi pi-trash" />
          </button>
          <button
            :title="t('toolbar.save')"
            :disabled="!hasUnsavedModifications"
            :class="btnCls()"
            @click="onSave"
          >
            <i class="pi pi-send" />
          </button>
        </template>
      </div>

      <!-- Teleport anchor for UnifiedProjectPopup (via PopupContainer) -->
      <div
        v-show="showInfoPopup"
        ref="infoSlot"
        class="absolute top-full left-0 w-0 h-0 overflow-visible pointer-events-none"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import L from "leaflet";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import type { OverlayObject } from "@/types";
import { map } from "@/services/core/map";
import { getLayer, getAllLayers } from "@/services/overlay/overlayRenderRegistry";
import { setOverlayPopupTarget } from "@/services/map/popupState";
import { overlayCallbacks } from "@/services/overlay/overlayLifecycle";
import "@/services/overlay/overlayActions"; // ensure navigateOverlaySequence callback is registered
import { useProjectStore } from "@/stores/pinia/projectStore";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";

const { t } = useI18n();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const pendingModsStore = usePendingModificationsStore();
const mapStore = useMapStore();
const { idSelectedOverlay } = storeToRefs(overlayStore);
const { mode } = storeToRefs(mapStore);
const selectedId = idSelectedOverlay;
const isEditMode = computed(() => mode.value === "edit");

// markerIconEl is the Leaflet marker's _icon div — we teleport our toolbar content inside it.
// Leaflet handles pan + zoom animation via CSS transforms on the marker pane automatically.
const markerIconEl = ref<HTMLElement | null>(null);
const opacity = ref(100);
const showInfoPopup = ref(false);
const infoSlot = ref<HTMLElement | null>(null);

// --- Anchor marker ---

let anchorMarker: L.Marker | null = null;
let retryRafId: number | null = null;

function getAnchorLatLng(): L.LatLng | null {
  const id = selectedId.value;
  if (!id) return null;
  const layer = getLayer(id);
  if (!layer) return null;
  try {
    const corners = layer.getCorners();
    if (!corners?.length) return null;
    const maxLat = Math.max(...corners.map((c) => c.lat));
    const center = L.latLngBounds(corners).getCenter();
    return L.latLng(maxLat, center.lng);
  } catch {
    return null;
  }
}

function destroyMarker() {
  anchorMarker?.remove();
  anchorMarker = null;
  markerIconEl.value = null;
  if (retryRafId !== null) {
    cancelAnimationFrame(retryRafId);
    retryRafId = null;
  }
  detachCollisionLayer();
  hasCollision.value = false;
}

function createMarker(latlng: L.LatLng) {
  if (!map.value) return;
  // Use a dedicated pane above markerPane (z-index 600) so the toolbar always renders on top of markers.
  if (!map.value.getPane("overlayToolbarPane")) {
    map.value.createPane("overlayToolbarPane").style.zIndex = "620";
  }
  anchorMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: "overlay-toolbar-anchor",
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    keyboard: false,
    pane: "overlayToolbarPane",
  }).addTo(map.value);
  // _icon is set synchronously by Leaflet's addTo → onAdd → _initIcon
  markerIconEl.value = (anchorMarker as any)._icon ?? null;
}

// RAF: Leaflet handles pan/zoom automatically. RAF only needed to update marker
// latlng while the user drags overlay handles (corner changes, no map event fires).
let rafId: number | null = null;

function startRAF() {
  if (rafId !== null) return;
  function tick() {
    if (anchorMarker && selectedId.value) {
      const latlng = getAnchorLatLng();
      if (latlng) {
        anchorMarker.setLatLng(latlng);
      } else {
        // Layer removed from registry while still selected (e.g. zoom-out unload with
        // preserveStoreData=true — idSelectedOverlay is not cleared in that path).
        overlayStore.idSelectedOverlay = null;
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopRAF() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}
// ─── SAT collision (convex quad vs convex quad) ───────────────────────────────

function projectOnAxis(corners: L.LatLng[], axLat: number, axLng: number) {
  let min = Infinity,
    max = -Infinity;
  for (const c of corners) {
    const p = c.lat * axLat + c.lng * axLng;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

function quadsOverlap(a: L.LatLng[], b: L.LatLng[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      /* oxlint-disable no-non-null-assertion */
      const p1 = poly[i]!;
      const p2 = poly[(i + 1) % poly.length]!;
      /* oxlint-enable no-non-null-assertion */
      const dlat = p2.lat - p1.lat;
      const dlng = p2.lng - p1.lng;
      const pa = projectOnAxis(a, -dlng, dlat);
      const pb = projectOnAxis(b, -dlng, dlat);
      if (pa.max < pb.min || pb.max < pa.min) return false;
    }
  }
  return true;
}

// ─── Collision detection ───────────────────────────────────────────────────────

const hasCollision = ref(false);
let collisionLayer: L.DistortableImageOverlay | null = null;

function checkCollision() {
  const id = selectedId.value;
  if (!id) {
    hasCollision.value = false;
    return;
  }
  const layer = getLayer(id);
  if (!layer) {
    hasCollision.value = false;
    return;
  }
  try {
    const corners = layer.getCorners();
    hasCollision.value = getAllLayers().some(([otherId, other]) => {
      if (otherId === id) return false;
      try {
        return quadsOverlap(corners, other.getCorners());
      } catch {
        return false;
      }
    });
  } catch {
    hasCollision.value = false;
  }
}

function attachCollisionLayer(id: string) {
  const layer = getLayer(id) as L.DistortableImageOverlay | null;
  if (!layer || layer === collisionLayer) return;
  detachCollisionLayer();
  collisionLayer = layer;
  layer.on("edit dragend", checkCollision);
}

function detachCollisionLayer() {
  if (collisionLayer) {
    collisionLayer.off("edit dragend", checkCollision);
    collisionLayer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function initForSelection() {
  if (!map.value) return;
  const latlng = getAnchorLatLng();
  if (!latlng) {
    // Layer not yet in registry (render loop hasn't created it yet after navigation).
    // Retry each frame until it appears; destroyMarker() cancels if selection changes.
    retryRafId = requestAnimationFrame(initForSelection);
    return;
  }
  retryRafId = null;
  createMarker(latlng);
  opacity.value = readOpacity();
  startRAF();
  if (selectedId.value) {
    attachCollisionLayer(selectedId.value);
  }
  checkCollision();
}

watch(
  selectedId,
  (id, prev) => {
    if (id !== prev) showInfoPopup.value = false;
    destroyMarker();
    stopRAF();
    // nextTick: let Teleport unmount cleanly from the old marker before we create a new one
    if (id) nextTick(initForSelection);
  },
  { immediate: true },
);

// Edge case: selectedId set before MapView's onMounted initializes the map
watch(
  map,
  (newMap, oldMap) => {
    oldMap?.off("moveend", checkCollision);
    if (newMap) {
      newMap.on("moveend", checkCollision);
      if (selectedId.value && !anchorMarker) initForSelection();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  stopRAF();
  destroyMarker();
  map.value.off("moveend", checkCollision);
});

function readOpacity(): number {
  const layer = getLayer(selectedId.value ?? "");
  const el = layer ? layer.getElement() : null;
  const attr = el?.getAttribute("opacity");
  return attr ? Math.round(Number.parseFloat(attr) * 100) : 100;
}

// Wire info slot as teleport target for PopupContainer's UnifiedProjectPopup
watch(showInfoPopup, (visible) => {
  if (visible) {
    nextTick(() => {
      setOverlayPopupTarget(infoSlot.value);
      if (selectedId.value) overlayStore.showInfoPopupForOverlay(selectedId.value);
    });
  } else {
    setOverlayPopupTarget(null);
    overlayStore.hideInfoPopup();
  }
});

// --- Nav / index ---

const overlayIndex = computed(() => {
  const id = selectedId.value;
  if (!id) return null;
  const overlay = overlayStore.overlays[id];
  if (!overlay?.projectId) return null;
  // Derive siblings from already-loaded overlays — avoids depending on projectStore.overlayIds
  // which is only populated when the info popup is opened (backend fetch).
  const siblings = Object.values(overlayStore.overlays)
    .filter((o) => o.projectId === overlay.projectId)
    .map((o) => o.id);
  if (siblings.length <= 1) return null;
  const idx = siblings.indexOf(id);
  return idx !== -1 ? { current: idx + 1, total: siblings.length } : null;
});

const showNav = computed(() => (overlayIndex.value?.total ?? 0) > 1);

const selectedOverlay = computed(() => overlayStore.overlays[selectedId.value ?? ""]);

const canDelete = computed(() => {
  return selectedOverlay.value ? canDeleteOverlay(selectedOverlay.value) : false;
});

const canReplaceImage = computed(() => {
  const status = selectedOverlay.value?.status;
  return status === "approved" || status === "rejected";
});

const canUndo = computed(() => (selectedOverlay.value?.history?.length ?? 0) > 1);
const canRedo = computed(() => (selectedOverlay.value?.redoStack?.length ?? 0) > 0);
const hasUnsavedModifications = computed(() => {
  const id = selectedId.value;
  if (!id) return false;
  return selectedOverlay.value?.isModified === true || pendingModsStore.hasPendingModifications(id);
});

// --- Actions ---

async function toggleInfoPopup() {
  if (!showInfoPopup.value) {
    const overlay = selectedId.value ? overlayStore.overlays[selectedId.value] : null;
    if (overlay?.projectId && !projectStore.projects[overlay.projectId] && !overlay.project) {
      try {
        const result = await trpc.project.getById.query({ id: overlay.projectId });
        if (result) {
          projectStore.updateProject(
            overlay.projectId,
            createProjectObject({ ...result, tags: result.tags ?? [], overlayIds: [] }),
          );
        }
      } catch (error) {
        console.error("Failed to fetch project for overlay popup:", error);
      }
    }
  }
  showInfoPopup.value = !showInfoPopup.value;
}

function onOpacityInput(e: Event) {
  const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
  opacity.value = val;
  const layer = getLayer(selectedId.value ?? "");
  if (layer) (layer as any).editing._setOpacities(val / 100);
}

function goToPrevious() {
  overlayCallbacks.focusCameraToOverlay?.("previous");
}
function goToNext() {
  overlayCallbacks.focusCameraToOverlay?.("next");
}

function stackToBack() {
  const layer = getLayer(selectedId.value ?? "");
  if (!layer) return;
  layer.bringToBack();
  (layer as any).editing._toggledImage = true;
}

function undo() {
  overlayCallbacks.undo?.();
}
function redo() {
  overlayCallbacks.redo?.();
}

const projectStore = useProjectStore();
const { handleDeleteOverlay } = useProjectDeletion();

// Use submission dialog composable to trigger the singleton dialog (rendered in Home.vue)
const { prepareOverlaySubmission } = useSubmissionDialog();

function onSave() {
  const overlay = selectedOverlay.value;
  if (!overlay) return;
  const project = projectStore.projects[overlay.projectId ?? ""] ?? null;
  prepareOverlaySubmission(overlay, project ?? undefined);
}

function onReplace() {
  const id = selectedId.value;
  if (!id) return;
  const overlay = overlayStore.overlays[id];
  if (!overlay?.projectId) return;
  overlayStore.requestOverlayReplacement(id);
  uiStore.openImageUploadDialog(overlay.projectId);
}

async function onDelete() {
  const id = selectedId.value;
  if (!id) return;
  const overlay = overlayStore.overlays[id];
  if (!overlay) return;
  const project = overlay.projectId ? (projectStore.projects[overlay.projectId] ?? null) : null;
  const overlayCount = overlay.projectId
    ? Object.values(overlayStore.overlays).filter((o) => o.projectId === overlay.projectId).length
    : 0;
  await handleDeleteOverlay(id, project, overlayCount, overlay.caption ?? null, () => {
    overlayStore.idSelectedOverlay = null;
  });
}

function canDeleteOverlay(overlayObject: OverlayObject): boolean {
  if (overlayObject.status === "approved") return false;
  if (overlayObject.status === "pending" || overlayObject.status === "rejected") return true;
  if (overlayObject.isModified) return true;
  return false;
}

function btnCls(opts?: { active?: boolean; danger?: boolean }): string {
  const base =
    "min-w-[26px] h-[26px] border-0 rounded-md cursor-pointer flex items-center justify-center text-sm px-1 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  if (opts?.active) return `${base} bg-indigo-100 text-indigo-600 hover:bg-indigo-100`;
  if (opts?.danger) return `${base} bg-transparent text-red-600 hover:bg-red-100`;
  return `${base} bg-transparent text-muted-color hover:bg-content-hover-background`;
}
</script>

<style>
/* Global: reset Leaflet's default DivIcon styles on our anchor marker */
.overlay-toolbar-anchor {
  background: none !important;
  border: none !important;
  overflow: visible !important;
}
</style>

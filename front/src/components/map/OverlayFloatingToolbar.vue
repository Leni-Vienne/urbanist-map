<template>
  <!-- Teleport into the maplibregl.Marker element; MapLibre owns pan/zoom positioning -->
  <Teleport :to="markerIconEl" v-if="markerIconEl">
    <div
      class="absolute -translate-x-1/2 -translate-y-[calc(100%+20px)] pointer-events-auto flex flex-col items-center gap-1 font-sans"
      @click.stop
      @mousedown.stop
      @dblclick.stop
      @touchstart.stop
    >
      <!-- Overlay name, shown above the controls when the overlay has a caption -->
      <div
        v-if="overlayName && !isCropActive"
        class="max-w-60 truncate bg-content-background border border-surface rounded-md py-0.5 px-2 shadow-[0_4px_12px_rgba(0,0,0,0.2)] text-[13px] font-medium text-color"
      >
        {{ overlayName }}
      </div>
      <div
        class="flex items-center gap-0.5 bg-content-background border border-surface rounded-lg py-1 px-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.2)] whitespace-nowrap"
      >
        <!-- Crop sub-mode: trim the image, then confirm or cancel -->
        <template v-if="isCropActive">
          <button :title="t('toolbar.cropConfirm')" :class="btnCls()" @click="confirmCrop">
            <i class="pi pi-check" />
          </button>
          <button :title="t('toolbar.cropCancel')" :class="btnCls()" @click="endCrop()">
            <i class="pi pi-times" />
          </button>
        </template>
        <template v-else>
          <!-- Opacity slider -->
          <input
            type="range"
            min="0"
            max="100"
            :value="opacity"
            @input="onOpacityInput"
            :title="`Opacity: ${opacity}%`"
            class="w-18 h-1 cursor-pointer accent-(--p-primary-color)"
          />
          <span class="text-[13px] text-muted-color min-w-7 text-right">{{ opacity }}%</span>

          <!-- Nav prev/next + index -->
          <template v-if="showNav">
            <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />
            <button
              :title="t('toolbar.previousOverlay')"
              :class="btnCls()"
              @click="navigateOverlaySequence('previous')"
            >
              <i class="pi pi-chevron-left" />
            </button>
            <span v-if="overlayIndex" class="text-[13px] text-muted-color min-w-7 text-center"
              >{{ overlayIndex.current }}/{{ overlayIndex.total }}</span
            >
            <button
              :title="t('toolbar.nextOverlay')"
              :class="btnCls()"
              @click="navigateOverlaySequence('next')"
            >
              <i class="pi pi-chevron-right" />
            </button>
          </template>

          <!-- Bring image to front / send to back, only when it overlaps a project shape -->
          <template v-if="canStack">
            <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />
            <button
              :title="isInFront ? t('toolbar.sendToBack') : t('toolbar.bringToFront')"
              :class="btnCls()"
              @click="toggleStacking"
            >
              <i :class="isInFront ? 'pi pi-arrow-down' : 'pi pi-arrow-up'" />
            </button>
          </template>

          <!-- Edit-only tools -->
          <template v-if="isEditMode">
            <span class="w-px h-4.5 bg-content-border-color mx-0.5 shrink-0" />
            <button
              :title="t('toolbar.undo')"
              :disabled="!canUndo"
              :class="btnCls()"
              @click="undo()"
            >
              <i class="pi pi-undo" />
            </button>
            <button v-if="canRedo" :title="t('toolbar.redo')" :class="btnCls()" @click="redo()">
              <i class="pi pi-refresh" />
            </button>
            <button :title="t('toolbar.editInfo')" :class="btnCls()" @click="onEditInfo">
              <i class="pi pi-pencil" />
            </button>
            <button
              v-if="canReplaceImage"
              :title="t('toolbar.replace')"
              :class="btnCls()"
              @click="onReplace"
            >
              <i class="pi pi-image" />
            </button>
            <button v-if="canCrop" :title="t('toolbar.crop')" :class="btnCls()" @click="startCrop">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6.13 1 6 16a2 2 0 0 0 2 2h15" />
                <path d="M1 6.13 16 6a2 2 0 0 1 2 2v15" />
              </svg>
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
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import maplibregl from "maplibre-gl";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useMapStore } from "@/stores/mapStore";
import { useUiStore } from "@/stores/uiStore";
import type { OverlayObject } from "@/types";
import { map } from "@/services/core/map";
import {
  getOverlayImageCorners,
  setOverlayImageOpacity,
  setOverlayInFront,
  isOverlayInFront,
  overlayOverlapsProjectShape,
  getImageHandle,
  whenImageReady,
} from "@/services/overlay/mapLayers";
import {
  navigateOverlaySequence,
  getProjectSiblingOverlayIds,
} from "@/services/overlay/navigation";
import { selectOverlay } from "@/services/overlay/selection";
import { showEditHandles, hideEditHandles } from "@/services/overlay/editing";
import { undo, redo } from "@/services/overlay/history";
import { showCropHandles, hideCropHandles, applyCrop } from "@/services/overlay/cropHandles";
import { prepareOverlaySubmission } from "@/services/submission/submissionDialog";
import { isOverlayUnsaved } from "@/services/overlay/unsavedState";
import { confirmAndDeleteOverlay } from "@/services/core/entityRemoval";

const { t } = useI18n();
const overlayStore = useOverlayStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();
const mapStore = useMapStore();
const { selectedOverlayId } = storeToRefs(focusStore);
const { mode } = storeToRefs(mapStore);
const selectedId = selectedOverlayId;
const isEditMode = computed(() => mode.value === "edit");

// markerIconEl is the maplibregl.Marker element; we teleport our toolbar content inside it.
// MapLibre handles pan + zoom positioning via a transform on the element automatically.
const markerIconEl = ref<HTMLElement | null>(null);
const opacity = ref(100);
const isInFront = computed(() => (selectedId.value ? isOverlayInFront(selectedId.value) : false));
const canStack = ref(false);
const isCropActive = ref(false);

let anchorMarker: maplibregl.Marker | null = null;
let cancelImageWait: (() => void) | null = null;

// Top-center of the overlay ([lng, lat]) where the toolbar anchors.
function getAnchorLngLat(): [number, number] | null {
  const id = selectedId.value;
  if (!id) return null;
  const corners = getOverlayImageCorners(id);
  if (!corners?.length) return null;
  const lats = corners.map((c) => c.lat);
  const lngs = corners.map((c) => c.lng);
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, Math.max(...lats)];
}

function destroyMarker() {
  anchorMarker?.remove();
  anchorMarker = null;
  markerIconEl.value = null;
  canStack.value = false;
  if (cancelImageWait) {
    cancelImageWait();
    cancelImageWait = null;
  }
}

// The front/back button only matters when the image sits over a project shape (otherwise toggling
// has no visible effect). Re-evaluated on selection, map move, and while the overlay is dragged.
function refreshCanStack() {
  const id = selectedId.value;
  canStack.value = id ? overlayOverlapsProjectShape(id) : false;
}

function createMarker(lngLat: [number, number]) {
  const mlMap = map.value;
  const el = document.createElement("div");
  el.style.zIndex = "620";
  anchorMarker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat(lngLat)
    .addTo(mlMap);
  markerIconEl.value = el;
}

// MapLibre repositions the anchor marker on pan/zoom automatically via its transform. A
// corner/surface drag mutates the overlay source and triggers a repaint, so the anchor follows
// the overlay by re-projecting on the map's "render" event.
let anchorSyncActive = false;

let lastOverlapCheckTs = 0;

function syncAnchor() {
  if (!anchorMarker || !selectedId.value) return;
  const lngLat = getAnchorLngLat();
  if (!lngLat) {
    // Image removed from registry while still selected (e.g. zoom-out unload with
    // preserveStoreData=true, which leaves the focus selection in place).
    selectOverlay(null);
    return;
  }
  anchorMarker.setLngLat(lngLat);
  // Throttled so a drag onto/off a project shape updates the button without querying every frame.
  const now = performance.now();
  if (now - lastOverlapCheckTs > 200) {
    lastOverlapCheckTs = now;
    refreshCanStack();
  }
}

function startAnchorSync() {
  const mlMap = map.value;
  if (anchorSyncActive) return;
  mlMap.on("render", syncAnchor);
  anchorSyncActive = true;
}

function stopAnchorSync() {
  if (!anchorSyncActive) return;
  map.value.off("render", syncAnchor);
  anchorSyncActive = false;
}

function initForSelection() {
  const id = selectedId.value;
  if (!id) return;
  const lngLat = getAnchorLngLat();
  if (!lngLat) {
    // Image not yet in registry (render loop hasn't created it yet after navigation).
    // Re-run once it comes online; destroyMarker() cancels if selection changes first.
    cancelImageWait = whenImageReady(id, initForSelection);
    return;
  }
  cancelImageWait = null;
  createMarker(lngLat);
  opacity.value = readOpacity();
  refreshCanStack();
  startAnchorSync();
}

watch(
  selectedId,
  (id, prev) => {
    if (id !== prev) abandonCrop();
    destroyMarker();
    stopAnchorSync();
    // nextTick: let Teleport unmount cleanly from the old marker before we create a new one
    if (id) nextTick(initForSelection);
  },
  { immediate: true },
);

// Edge case: selectedId set before MapView's onMounted initializes the map
watch(
  map,
  (newMap, oldMap) => {
    oldMap?.off("moveend", refreshCanStack);
    if (newMap) {
      newMap.on("moveend", refreshCanStack);
      if (selectedId.value && !anchorMarker) initForSelection();
    }
  },
  { immediate: true },
);

watch(isEditMode, (editing) => {
  if (!editing) abandonCrop();
});

onUnmounted(() => {
  stopAnchorSync();
  destroyMarker();
  abandonCrop();
  map.value.off("moveend", refreshCanStack);
});

function readOpacity(): number {
  const id = selectedId.value;
  const handle = id ? getImageHandle(id) : null;
  return handle ? Math.round(handle.opacity * 100) : 100;
}

const overlayIndex = computed(() => {
  const id = selectedId.value;
  if (!id) return null;
  const overlay = overlayStore.liveOverlays[id];
  if (!overlay?.projectId) return null;
  // Same source as navigateOverlaySequence, so the displayed index matches prev/next.
  const siblings = getProjectSiblingOverlayIds(overlay.projectId);
  if (siblings.length <= 1) return null;
  const idx = siblings.indexOf(id);
  return idx !== -1 ? { current: idx + 1, total: siblings.length } : null;
});

const showNav = computed(() => (overlayIndex.value?.total ?? 0) > 1);

const selectedOverlay = computed(() => overlayStore.liveOverlays[selectedId.value ?? ""]);

const overlayName = computed(() => selectedOverlay.value?.caption?.trim() || null);

const canDelete = computed(() => {
  return selectedOverlay.value ? canDeleteOverlay(selectedOverlay.value) : false;
});

// Rejected overlays are never visible/selectable (isOverlayVisible filters them out in
// edit and moderation), so the toolbar's overlay is only ever approved/pending/local here.
const canReplaceImage = computed(() => {
  return selectedOverlay.value?.status === "approved";
});

// Crop only local (not yet submitted) overlays, whose image bytes can still be re-baked and
// re-uploaded through the normal publish path. Once submitted, the stored copy is already
// server-compressed, so startCrop refuses it and points the user to delete + re-upload instead.
const canCrop = computed(() => selectedOverlay.value?.status === null);

const canUndo = computed(() => (selectedOverlay.value?.history?.length ?? 0) > 1);
const canRedo = computed(() => (selectedOverlay.value?.redoStack?.length ?? 0) > 0);
const hasUnsavedModifications = computed(() => {
  const overlay = selectedOverlay.value;
  return overlay ? isOverlayUnsaved(overlay) : false;
});

function onOpacityInput(e: Event) {
  const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
  opacity.value = val;
  const id = selectedId.value;
  if (id) setOverlayImageOpacity(id, val / 100);
}

function toggleStacking() {
  const id = selectedId.value;
  if (!id) return;
  setOverlayInFront(id, !isInFront.value);
}

function onSave() {
  const overlay = selectedOverlay.value;
  if (!overlay) return;
  prepareOverlaySubmission(overlay);
}

function startCrop() {
  // Only local (status === null) overlays expose the crop button (see canCrop), so the image bytes
  // here are always the un-submitted source, safe to re-bake and re-upload via the publish path.
  const overlay = selectedOverlay.value;
  if (!overlay) return;
  hideEditHandles();
  showCropHandles(overlay);
  isCropActive.value = true;
}

function abandonCrop() {
  if (!isCropActive.value) return;
  hideCropHandles();
  isCropActive.value = false;
}

function endCrop() {
  abandonCrop();
  const overlay = selectedOverlay.value;
  if (overlay && isEditMode.value) showEditHandles(overlay);
}

async function confirmCrop() {
  await applyCrop();
  endCrop();
}

function onEditInfo() {
  const overlay = selectedOverlay.value;
  if (!overlay) return;
  uiStore.openOverlayEditDialog(overlay);
}

function onReplace() {
  const id = selectedId.value;
  if (!id) return;
  const overlay = overlayStore.liveOverlays[id];
  if (!overlay?.projectId) return;
  overlayStore.requestOverlayReplacement(id);
  uiStore.openImageUploadDialog(overlay.projectId);
}

async function onDelete() {
  const id = selectedId.value;
  if (!id) return;
  const overlay = overlayStore.liveOverlays[id];
  if (!overlay) return;
  // Deselection (handles, highlight, docked detail) happens in removeOverlayFromMapAndStore.
  await confirmAndDeleteOverlay(id, overlay.caption ?? null);
}

function canDeleteOverlay(overlayObject: OverlayObject): boolean {
  if (overlayObject.status === "approved") return false;
  // Rejected overlays are never selectable here (isOverlayVisible filters them out).
  if (overlayObject.status === "pending") return true;
  if (isOverlayUnsaved(overlayObject)) return true;
  return false;
}

function btnCls(opts?: { danger?: boolean }): string {
  const base =
    "min-w-[26px] h-[26px] border-0 rounded-md cursor-pointer flex items-center justify-center text-sm px-1 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  if (opts?.danger) return `${base} bg-transparent text-red-600 hover:bg-red-100`;
  return `${base} bg-transparent text-muted-color hover:bg-content-hover-background`;
}
</script>

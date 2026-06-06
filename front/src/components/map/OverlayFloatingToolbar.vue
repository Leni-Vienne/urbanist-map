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
      <div
        class="flex items-center gap-0.5 bg-content-background border border-surface rounded-lg py-1 px-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.2)] whitespace-nowrap"
      >
        <!-- Crop sub-mode: trim the image, then confirm or cancel -->
        <template v-if="isCropActive">
          <button :title="t('toolbar.cropConfirm')" :class="btnCls()" @click="confirmCrop">
            <i class="pi pi-check" />
          </button>
          <button :title="t('toolbar.cropCancel')" :class="btnCls()" @click="cancelCrop">
            <i class="pi pi-times" />
          </button>
        </template>
        <template v-else>
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
import maplibregl from "maplibre-gl";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import type { OverlayObject } from "@/types";
import { map } from "@/services/core/map";
import { getImageHandle } from "@/services/overlay/overlayRenderRegistry";
import {
  getOverlayImageCorners,
  setOverlayImageOpacity,
  setOverlayInFront,
  isOverlayInFront,
  overlayOverlapsProjectShape,
} from "@/services/overlay/overlayImageLayer";
import { setOverlayPopupTarget } from "@/services/map/popupState";
import { navigateOverlaySequence } from "@/services/overlay/overlayActions";
import {
  undo as undoOverlayEdit,
  redo as redoOverlayEdit,
} from "@/services/overlay/overlayEditing";
import { showEditHandles, hideEditHandles } from "@/services/overlay/overlayEditHandles";
import { showCropHandles, hideCropHandles, applyCrop } from "@/services/overlay/overlayCropHandles";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { isOverlayUnsaved } from "@/utils/unsavedState";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";

const { t } = useI18n();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const mapStore = useMapStore();
const { idSelectedOverlay } = storeToRefs(overlayStore);
const { mode } = storeToRefs(mapStore);
const selectedId = idSelectedOverlay;
const isEditMode = computed(() => mode.value === "edit");

// markerIconEl is the maplibregl.Marker element; we teleport our toolbar content inside it.
// MapLibre handles pan + zoom positioning via a transform on the element automatically.
const markerIconEl = ref<HTMLElement | null>(null);
const opacity = ref(100);
const isInFront = ref(false);
const canStack = ref(false);
const showInfoPopup = ref(false);
const infoSlot = ref<HTMLElement | null>(null);
const isCropActive = ref(false);

let anchorMarker: maplibregl.Marker | null = null;
let retryRafId: number | null = null;

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
  if (retryRafId !== null) {
    cancelAnimationFrame(retryRafId);
    retryRafId = null;
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
  if (!mlMap) return;
  const el = document.createElement("div");
  el.style.zIndex = "620";
  anchorMarker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat(lngLat)
    .addTo(mlMap);
  markerIconEl.value = el;
}

// RAF: MapLibre handles pan/zoom automatically. RAF only updates the anchor while the user
// drags overlay handles (corner changes, no map event fires).
let rafId: number | null = null;

let lastOverlapCheckTs = 0;

function startRAF() {
  if (rafId !== null) return;
  function tick(ts: number) {
    if (anchorMarker && selectedId.value) {
      const lngLat = getAnchorLngLat();
      if (lngLat) {
        anchorMarker.setLngLat(lngLat);
      } else {
        // Image removed from registry while still selected (e.g. zoom-out unload with
        // preserveStoreData=true, idSelectedOverlay is not cleared in that path).
        overlayStore.idSelectedOverlay = null;
      }
      // Throttled so a drag onto/off a project shape updates the button without querying every frame.
      if (ts - lastOverlapCheckTs > 200) {
        lastOverlapCheckTs = ts;
        refreshCanStack();
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

function initForSelection() {
  if (!map.value) return;
  const lngLat = getAnchorLngLat();
  if (!lngLat) {
    // Image not yet in registry (render loop hasn't created it yet after navigation).
    // Retry each frame until it appears; destroyMarker() cancels if selection changes.
    retryRafId = requestAnimationFrame(initForSelection);
    return;
  }
  retryRafId = null;
  createMarker(lngLat);
  opacity.value = readOpacity();
  isInFront.value = selectedId.value ? isOverlayInFront(selectedId.value) : false;
  refreshCanStack();
  startRAF();
}

watch(
  selectedId,
  (id, prev) => {
    if (id !== prev) {
      showInfoPopup.value = false;
      if (isCropActive.value) {
        hideCropHandles();
        isCropActive.value = false;
      }
    }
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
    oldMap?.off("moveend", refreshCanStack);
    if (newMap) {
      newMap.on("moveend", refreshCanStack);
      if (selectedId.value && !anchorMarker) initForSelection();
    }
  },
  { immediate: true },
);

// Leaving edit mode (e.g. via the mode toggle) tears down edit handles elsewhere; abandon any
// in-progress crop so its handles and mask don't dangle.
watch(isEditMode, (editing) => {
  if (!editing && isCropActive.value) {
    hideCropHandles();
    isCropActive.value = false;
  }
});

onUnmounted(() => {
  stopRAF();
  destroyMarker();
  if (isCropActive.value) hideCropHandles();
  map.value?.off("moveend", refreshCanStack);
});

function readOpacity(): number {
  const id = selectedId.value;
  const handle = id ? getImageHandle(id) : null;
  return handle ? Math.round(handle.opacity * 100) : 100;
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

const overlayIndex = computed(() => {
  const id = selectedId.value;
  if (!id) return null;
  const overlay = overlayStore.overlays[id];
  if (!overlay?.projectId) return null;
  // Derive siblings from already-loaded overlays
  // to avoid depending on projectStore.overlayIds (only populated on popup open).
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
  const id = selectedId.value;
  if (id) setOverlayImageOpacity(id, val / 100);
}

function goToPrevious() {
  navigateOverlaySequence("previous");
}
function goToNext() {
  navigateOverlaySequence("next");
}

function toggleStacking() {
  const id = selectedId.value;
  if (!id) return;
  const next = !isInFront.value;
  setOverlayInFront(id, next);
  isInFront.value = next;
}

function undo() {
  undoOverlayEdit();
}
function redo() {
  redoOverlayEdit();
}

const projectStore = useProjectStore();
const { handleDeleteOverlay } = useProjectDeletion();

// Use submission dialog composable to trigger the singleton dialog (rendered in Home.vue)
const { prepareOverlaySubmission } = useSubmissionDialog();

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

function endCrop() {
  hideCropHandles();
  isCropActive.value = false;
  const overlay = selectedOverlay.value;
  if (overlay && isEditMode.value) showEditHandles(overlay);
}

async function confirmCrop() {
  await applyCrop();
  endCrop();
}

function cancelCrop() {
  endCrop();
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
  // Rejected overlays are never selectable here (isOverlayVisible filters them out).
  if (overlayObject.status === "pending") return true;
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

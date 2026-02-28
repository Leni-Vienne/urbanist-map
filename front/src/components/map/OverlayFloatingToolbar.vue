<template>
  <!-- Teleport into the Leaflet marker icon — Leaflet owns pan/zoom positioning -->
  <Teleport :to="markerIconEl" v-if="markerIconEl">
    <div
      class="toolbar-anchor"
      @click.stop
      @mousedown.stop
      @dblclick.stop
      @wheel.stop
      @touchstart.stop
    >
      <div class="toolbar-bar">
        <!-- Info toggle -->
        <button
          :title="t('toolbar.info')"
          :class="{ active: showInfoPopup }"
          @click="toggleInfoPopup"
        >
          ℹ
        </button>

        <span class="sep" />

        <!-- Opacity slider -->
        <input
          type="range"
          min="0"
          max="100"
          :value="opacity"
          @input="onOpacityInput"
          :title="`Opacity: ${opacity}%`"
        />
        <span class="opacity-label">{{ opacity }}%</span>

        <!-- Nav prev/next + index -->
        <template v-if="showNav">
          <span class="sep" />
          <button :title="t('toolbar.previousOverlay')" @click="goToPrevious">‹</button>
          <span v-if="overlayIndex" class="index-label"
            >{{ overlayIndex.current }}/{{ overlayIndex.total }}</span
          >
          <button :title="t('toolbar.nextOverlay')" @click="goToNext">›</button>
        </template>

        <span class="sep" />
        <button title="Bring to front" @click="stackToFront">↑</button>
        <button title="Send to back" @click="stackToBack">↓</button>

        <!-- Edit-only tools -->
        <template v-if="isEditMode">
          <span class="sep" />
          <button :title="t('toolbar.undo')" :disabled="!canUndo" @click="undo">
            <i class="pi pi-undo" />
          </button>
          <button v-if="canRedo" :title="t('toolbar.redo')" @click="redo">
            <i class="pi pi-refresh" />
          </button>
          <button v-if="canReplaceImage" :title="t('toolbar.replace')" @click="onReplace">
            <i class="pi pi-image" />
          </button>
          <button v-if="canDelete" :title="t('toolbar.delete')" class="danger" @click="onDelete">
            <i class="pi pi-trash" />
          </button>
          <button :title="t('toolbar.save')" :disabled="!hasUnsavedModifications" @click="onSave">
            <i class="pi pi-save" />
          </button>
        </template>
      </div>

      <!-- Teleport anchor for UnifiedProjectPopup (via PopupContainer) -->
      <div v-show="showInfoPopup" ref="infoSlot" class="info-anchor" />
    </div>
  </Teleport>

  <SubmissionConfirmationDialog
    v-if="showSubmissionDialog"
    v-model:visible="showSubmissionDialog"
    :summary="submissionSummary"
    :is-submitting="isSubmitting"
    @confirm="confirmSubmission"
    @cancel="cancelSubmission"
    @remove-change="handleRemoveChange"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick, defineAsyncComponent } from "vue";
import L from "leaflet";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { type OverlayObject } from "@/types";
import { useToast } from "@/composables/ui/useToast";
import { map } from "@/services/core/map";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";
import { setOverlayPopupTarget } from "@/services/map/popupState";
import { overlayCallbacks } from "@/services/overlay/overlayLifecycle";
import "@/services/overlay/overlayActions"; // ensure navigateOverlaySequence callback is registered
import { deleteOverlayDirect } from "@/services/core/entityRemoval";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";

const { t } = useI18n();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const toast = useToast();
const pendingModsStore = usePendingModificationsStore();

const { idSelectedOverlay, mode } = storeToRefs(overlayStore);
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
    const corners: L.LatLng[] = (layer as any).getCorners();
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
}

function createMarker(latlng: L.LatLng) {
  if (!map.value) return;
  // Use a dedicated pane above markerPane (z-index 600) so the toolbar always renders on top of markers.
  if (!map.value.getPane("overlayToolbarPane")) {
    map.value.createPane("overlayToolbarPane").style.zIndex = "620";
  }
  anchorMarker = L.marker(latlng, {
    icon: L.divIcon({ className: "overlay-toolbar-anchor", iconSize: [0, 0], iconAnchor: [0, 0] }),
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
  const tick = () => {
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
  };
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
  (newMap) => {
    if (newMap && selectedId.value && !anchorMarker) initForSelection();
  },
  { immediate: true },
);

onUnmounted(() => {
  stopRAF();
  destroyMarker();
});

function readOpacity(): number {
  const layer = getLayer(selectedId.value ?? "");
  const el = layer ? ((layer as any).getElement?.() as HTMLElement | null) : null;
  const attr = el?.getAttribute("opacity");
  return attr ? Math.round(parseFloat(attr) * 100) : 100;
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

function toggleInfoPopup() {
  showInfoPopup.value = !showInfoPopup.value;
}

function onOpacityInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10);
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

function stackToFront() {
  const layer = getLayer(selectedId.value ?? "");
  if (!layer) return;
  (layer as any).bringToFront();
  (layer as any).editing._toggledImage = false;
}

function stackToBack() {
  const layer = getLayer(selectedId.value ?? "");
  if (!layer) return;
  (layer as any).bringToBack();
  (layer as any).editing._toggledImage = true;
}

function undo() {
  overlayCallbacks.undo?.();
}
function redo() {
  overlayCallbacks.redo?.();
}

const projectStore = useProjectStore();

const {
  showSubmissionDialog,
  submissionSummary,
  isSubmitting,
  prepareOverlaySubmission,
  confirmSubmission,
  cancelSubmission,
  handleRemoveChange,
} = useSubmissionDialog();

const SubmissionConfirmationDialog = defineAsyncComponent(
  () => import("@/components/submission/SubmissionConfirmationDialog.vue"),
);

function onSave() {
  const overlay = selectedOverlay.value;
  if (!overlay) return;
  const project =
    projectStore.projects[overlay.projectId ?? ""] ??
    projectStore.allProjects[overlay.projectId ?? ""] ??
    null;
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
  const name = overlay.caption ?? "this overlay";
  if (!confirm(t("overlay.confirmDelete", { name }))) return;
  await withErrorHandling(
    async () => {
      const ok = await deleteOverlayDirect(id, {
        updateUserContributions: true,
        clearCityCaches: true,
      });
      if (ok) {
        overlayStore.idSelectedOverlay = null;
        toast.add({ severity: "success", summary: "Overlay deleted", life: 3000 });
      }
    },
    { errorMessage: "Failed to delete overlay", logError: true },
  );
}

function canDeleteOverlay(overlayObject: OverlayObject): boolean {
  if (overlayObject.status === "approved") return false;
  if (overlayObject.status === "pending" || overlayObject.status === "rejected") return true;
  if (overlayObject.isModified) return true;
  return false;
}
</script>

<style scoped>
/* toolbar-anchor sits inside the 0×0 marker icon — absolutely positioned above the anchor point */
.toolbar-anchor {
  position: absolute;
  transform: translate(-50%, calc(-100% - 20px));
  pointer-events: all;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-family: system-ui, sans-serif;
}

.toolbar-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 4px 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}

.toolbar-bar button {
  min-width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #374151;
  padding: 0 4px;
}

.toolbar-bar button:hover {
  background: #f3f4f6;
}
.toolbar-bar button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.toolbar-bar button:disabled:hover {
  background: transparent;
}
.toolbar-bar button.active {
  background: #e0e7ff;
  color: #4f46e5;
}
.toolbar-bar button.danger {
  color: #dc2626;
}
.toolbar-bar button.danger:hover {
  background: #fee2e2;
}

.sep {
  width: 1px;
  height: 18px;
  background: #e5e7eb;
  margin: 0 2px;
  flex-shrink: 0;
}

.opacity-label,
.index-label {
  font-size: 11px;
  color: #9ca3af;
  min-width: 28px;
  text-align: right;
}

.index-label {
  text-align: center;
}

input[type="range"] {
  width: 72px;
  height: 4px;
  cursor: pointer;
  accent-color: #4f46e5;
}

/* Teleport anchor for UnifiedProjectPopup — zero-size, aligned with left edge of toolbar-bar */
.info-anchor {
  position: absolute;
  top: 100%;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
}
</style>

<style>
/* Global: reset Leaflet's default DivIcon styles on our anchor marker */
.overlay-toolbar-anchor {
  background: none !important;
  border: none !important;
  overflow: visible !important;
}
</style>

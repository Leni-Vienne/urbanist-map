<template>
  <div
    :class="[
      'unified-popup',
      `popup-source-${props.source}`,
      props.source === 'marker' ? `popup-placement-${projectPopupPlacement}` : '',
    ]"
    class="w-max min-w-60 max-w-80 min-h-50 bg-content-background cursor-text select-text rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_6px_rgba(0,0,0,0.06)] pointer-events-auto relative z-1000"
    @click.stop
    @mousedown.stop
    @touchstart.stop
    @touchmove.stop
    @touchend.stop
  >
    <div v-if="loading" class="flex justify-center items-center h-50 p-4">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div
      v-else
      class="flex flex-col overflow-hidden"
      :style="
        props.source === 'marker'
          ? { maxHeight: projectPopupMaxHeight + 'px' }
          : { maxHeight: '31.25rem' }
      "
    >
      <!-- Project header: project name + action buttons -->
      <div class="px-4 pt-3 pb-2 border-b border-surface shrink-0">
        <div :class="['flex gap-2', overlay ? 'items-start' : 'items-center']">
          <!-- Left: project name stacked above overlay subtitle -->
          <div class="flex-1 flex flex-col gap-0.5 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <!-- Wikidata logo (e.g. metro line badge) shown when available -->
              <img
                v-if="wikidataEntity?.logoUrl"
                :src="wikidataEntity.logoUrl"
                class="w-5 h-5 object-contain shrink-0"
                referrerpolicy="no-referrer"
                loading="eager"
              />
              <span
                class="text-sm font-semibold leading-snug"
                :class="[
                  project?.name ? 'text-color' : 'text-muted-color italic',
                  isMobile ? 'wrap-break-word' : 'truncate',
                ]"
                v-tooltip.bottom="!isMobile ? project?.name || undefined : undefined"
              >
                {{ project?.name || $t("project.unnamed") }}
              </span>
            </div>
            <!-- Overlay subtitle: image name or untitled + text "modifier" link -->
            <div v-if="overlay" class="flex items-baseline gap-1.5">
              <span class="text-xs italic text-muted-color leading-snug">
                {{ overlay.caption || $t("overlay.untitled") }}
              </span>
              <button
                v-if="!viewMode && user"
                type="button"
                class="text-xs italic text-primary-400 hover:text-primary-700 dark:hover:text-primary-200 cursor-pointer bg-transparent border-none p-0 outline-none shrink-0"
                @click="emit('edit-overlay', overlay)"
              >
                {{ $t("common.edit") }}
              </button>
              <button
                v-if="
                  !viewMode && user && overlay.status === 'pending' && overlay.authorId === user.id
                "
                type="button"
                class="text-xs italic text-red-400 hover:text-red-600 dark:hover:text-red-300 cursor-pointer bg-transparent border-none p-0 outline-none shrink-0"
                @click="emit('delete-overlay', overlay)"
              >
                {{ $t("common.delete") }}
              </button>
            </div>
          </div>
          <!-- Right: project action buttons -->
          <div class="flex gap-1 shrink-0">
            <!-- Edit button (owned = direct edit, non-owned = suggest changes) -->
            <button
              v-if="!viewMode && project && user"
              type="button"
              :aria-label="
                project.ownerId === user.id ? $t('project.edit') : $t('tooltips.suggestChanges')
              "
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-primary-200"
              @click="emit('edit-project', project)"
              v-tooltip.top="
                project.ownerId === user.id ? $t('project.edit') : $t('tooltips.suggestChanges')
              "
            >
              <i class="pi pi-pencil"></i>
            </button>
            <!-- Delete button (for unsubmitted projects or pending projects owned by user) -->
            <button
              v-if="canDeleteProject"
              type="button"
              :aria-label="$t('contribute.deleteProject')"
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
              @click="emit('delete-project', project)"
              v-tooltip.top="$t('contribute.deleteProject')"
            >
              <i class="pi pi-trash"></i>
            </button>
            <!-- Close button (only for project-only view) -->
            <button
              v-if="!overlay"
              type="button"
              :aria-label="$t('common.close')"
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-muted-color hover:text-color hover:bg-content-hover-background"
              @click="emit('close-popup')"
              v-tooltip.top="$t('common.close')"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Project fields + overlay section, wheel.stop prevents map zoom while scrolling -->
      <div class="px-4 pt-3 pb-4 overflow-y-auto touch-pan-y overscroll-contain" @wheel.stop>
        <ProjectMetadataCard
          :project="project"
          :show-name="false"
          :show-description="true"
          :edit-mode="!viewMode"
          @field-click="emit('edit-project', project)"
        />

        <!-- Wikidata main image (P18) shown at the bottom of the metadata section. Click to zoom. -->
        <div v-if="wikidataEntity?.imageUrl" class="mt-3 pt-3 border-t border-surface">
          <img
            :src="wikidataEntity.imageUrl"
            class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
            referrerpolicy="no-referrer"
            loading="lazy"
            v-tooltip.top="$t('overlay.viewFullImage')"
            @click="
              openLightbox({
                url: wikidataEntity.imageUrl,
                header: project?.name || $t('project.unnamed'),
                referrerpolicy: 'no-referrer',
              })
            "
          />
        </div>

        <!-- Render (artist's impression): a user-contributed, non-georeferenced project image.
             Added/replaced via the project edit form, not here. Click to view full size. -->
        <div v-if="renderImageUrl" class="mt-3 pt-3 border-t border-surface flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-muted-color">{{ $t("render.label") }}</span>
          <img
            :src="renderImageUrl"
            :crossorigin="renderImageCrossorigin"
            class="w-full rounded-lg object-cover max-h-48 cursor-zoom-in"
            loading="lazy"
            v-tooltip.top="$t('overlay.viewFullImage')"
            @click="
              openLightbox({
                url: renderImageUrl,
                header: $t('render.label'),
                crossorigin: renderImageCrossorigin,
              })
            "
          />
          <span
            v-if="renderImage && renderImage.status !== 'approved'"
            class="text-xs italic text-muted-color"
          >
            {{ $t("render.pendingReview") }}
          </span>
        </div>

        <!-- Show view original button for pending replacements -->
        <div
          v-if="overlay?.replacesOverlayId && overlay?.status === 'pending'"
          class="mt-3 pt-3 border-t border-surface"
        >
          <button
            type="button"
            class="inline-flex items-center gap-2 font-medium text-sm text-purple-600 bg-purple-50 border border-purple-200 rounded-md cursor-pointer px-3 py-1.5 transition-all w-full justify-center hover:bg-purple-100 hover:border-purple-300 hover:text-purple-700"
            @click.stop="emit('view-original-overlay', overlay.replacesOverlayId)"
          >
            <i class="pi pi-arrow-left text-sm"></i>
            {{ $t("overlay.viewOriginalOverlay") }}
          </button>
        </div>
      </div>

      <!-- Action buttons footer, stays visible while the content above scrolls -->
      <div v-if="!viewMode" class="px-4 pb-4 pt-0 flex flex-col gap-2 shrink-0">
        <div class="flex gap-2">
          <Button
            class="flex-1"
            type="button"
            :label="$t('shapes.drawShapes')"
            severity="secondary"
            outlined
            @click="handleDrawShapesClick"
          >
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="lucide lucide-waypoints-icon lucide-waypoints"
              >
                <path d="m10.586 5.414-5.172 5.172" />
                <path d="m18.586 13.414-5.172 5.172" />
                <path d="M6 12h12" />
                <circle cx="12" cy="20" r="2" />
                <circle cx="12" cy="4" r="2" />
                <circle cx="20" cy="12" r="2" />
                <circle cx="4" cy="12" r="2" />
              </svg>
            </template>
          </Button>
          <Button
            class="flex-1"
            type="button"
            :label="$t('project.addImages')"
            severity="secondary"
            outlined
            @click="emit('add-images')"
          >
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M16 5h6" />
                <path d="M19 2v6" />
                <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                <circle cx="9" cy="9" r="2" />
              </svg>
            </template>
          </Button>
        </div>
        <Button
          class="w-full"
          type="button"
          :label="$t('project.submitChangeRequest')"
          icon="pi pi-send"
          severity="success"
          :loading="publishLoading"
          :disabled="!hasChanges"
          @click="handlePublishClick"
        />
      </div>
    </div>
  </div>

  <!-- Full-size image lightbox: scroll to zoom (toward cursor), drag to pan, double-click to reset -->
  <Dialog
    v-model:visible="lightboxVisible"
    modal
    dismissableMask
    :draggable="false"
    :header="lightboxImage?.header"
    :style="{ width: 'auto', maxWidth: '90vw' }"
    :pt="{ content: { class: 'p-0' } }"
  >
    <div
      class="overflow-hidden max-h-[80vh] max-w-[90vw] flex items-center justify-center touch-none"
      @wheel.prevent="handleLightboxWheel"
      @pointerdown="handleLightboxPointerDown"
      @pointermove="handleLightboxPointerMove"
      @pointerup="handleLightboxPointerUp"
      @pointerleave="handleLightboxPointerUp"
      @dblclick="resetLightboxZoom"
    >
      <img
        v-if="lightboxImage"
        ref="lightboxImgRef"
        :src="lightboxImage.url"
        :crossorigin="lightboxImage.crossorigin"
        :referrerpolicy="lightboxImage.referrerpolicy"
        class="block max-h-[80vh] max-w-[90vw] object-contain select-none"
        :class="
          lightboxZoom > 1
            ? isPanningLightbox
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-zoom-in'
        "
        :style="{
          transform: `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${lightboxZoom})`,
        }"
        draggable="false"
        alt=""
      />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Dialog } from "primevue";
import { projectPopupPlacement, projectPopupMaxHeight } from "@/services/map/popupState";
import { useWikidataEntity } from "@/composables/project/useWikidataEntity";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import type { OverlayObject, Project } from "@/types/index";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { isOverlayUnsaved, isProjectUnsaved } from "@/utils/unsavedState";
import { buildImageUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { trpc } from "@/client";

import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";

const { t: $t } = useI18n();
const toast = useToast();
const { isMobile } = useIsMobile();

interface Props {
  project: Project;
  overlay?: OverlayObject | null;
  viewMode?: boolean;
  publishLoading?: boolean;
  loading?: boolean;
  // Source determines popup positioning - overlay toolbar vs project marker
  source?: "overlay" | "marker";
}

const props = withDefaults(defineProps<Props>(), {
  overlay: null,
  viewMode: false,
  publishLoading: false,
  loading: false,
  source: "overlay",
});

const emit = defineEmits<{
  "edit-project": [project: Project];
  "edit-overlay": [overlay: OverlayObject];
  "publish-overlay": [];
  "publish-project": [];
  "close-popup": [];
  "add-images": [];
  "draw-shapes": [project: Project];
  "view-original-overlay": [overlayId: string];
  "delete-project": [project: Project];
  "delete-overlay": [overlay: OverlayObject];
}>();

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);
const projectStore = useProjectStore();

// Project render (artist's impression), delivered with the project by project.getById. The backend
// already scopes this to approved or the user's own pending render; we just hide a pending render
// while in view mode (so the live view<->edit toggle is purely a computed, no refetch).
const renderImage = computed(() => props.project?.render ?? null);

// Shared lightbox: any image in the popup (render, wikidata) opens here with scroll-to-zoom
// (toward the cursor) and drag-to-pan.
interface LightboxImage {
  url: string;
  header: string;
  crossorigin?: "use-credentials" | "anonymous" | "";
  referrerpolicy?: ReferrerPolicy;
}
const lightboxImage = ref<LightboxImage | null>(null);
const lightboxImgRef = ref<HTMLImageElement | null>(null);
const lightboxZoom = ref(1);
const lightboxPan = reactive({ x: 0, y: 0 });
const isPanningLightbox = ref(false);
const panStart = { x: 0, y: 0 };

const MIN_LIGHTBOX_ZOOM = 1;
const MAX_LIGHTBOX_ZOOM = 8;

const lightboxVisible = computed({
  get: () => lightboxImage.value !== null,
  set: (value: boolean) => {
    if (!value) lightboxImage.value = null;
  },
});

function openLightbox(image: LightboxImage) {
  lightboxImage.value = image;
}

function resetLightboxZoom() {
  lightboxZoom.value = 1;
  lightboxPan.x = 0;
  lightboxPan.y = 0;
}

// Zoom toward the cursor: keep the image point under the cursor fixed by shifting the pan by the
// cursor's offset from the rendered center, scaled by how much the zoom changed.
function handleLightboxWheel(event: WheelEvent) {
  const img = lightboxImgRef.value;
  if (!img) return;

  const oldZoom = lightboxZoom.value;
  const next = Math.min(
    MAX_LIGHTBOX_ZOOM,
    Math.max(MIN_LIGHTBOX_ZOOM, oldZoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2)),
  );
  if (next === oldZoom) return;

  if (next === 1) {
    resetLightboxZoom();
    return;
  }

  const rect = img.getBoundingClientRect();
  const offsetX = event.clientX - (rect.left + rect.width / 2);
  const offsetY = event.clientY - (rect.top + rect.height / 2);
  const factor = next / oldZoom;
  lightboxPan.x += offsetX * (1 - factor);
  lightboxPan.y += offsetY * (1 - factor);
  lightboxZoom.value = next;
}

function handleLightboxPointerDown(event: PointerEvent) {
  if (lightboxZoom.value <= 1) return;
  isPanningLightbox.value = true;
  panStart.x = event.clientX - lightboxPan.x;
  panStart.y = event.clientY - lightboxPan.y;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function handleLightboxPointerMove(event: PointerEvent) {
  if (!isPanningLightbox.value) return;
  lightboxPan.x = event.clientX - panStart.x;
  lightboxPan.y = event.clientY - panStart.y;
}

function handleLightboxPointerUp() {
  isPanningLightbox.value = false;
}

// Reset zoom whenever the lightbox opens or closes so it never reopens mid-zoom.
watch(lightboxVisible, resetLightboxZoom);

// Marker popups load their project via getById (render included), but overlay popups build it from
// the viewport payload, which omits render (undefined). Hydrate that one case via getById.
watch(
  () => props.project?.id,
  async (id) => {
    const project = props.project;
    if (!id || !project || project.status === null || project.render !== undefined) return;
    try {
      const fresh = await trpc.project.getById.query({ id });
      if (fresh) projectStore.updateProject(id, { render: fresh.render ?? null });
    } catch (error) {
      console.error("Failed to hydrate project render:", error);
    }
  },
  { immediate: true },
);

const renderImageUrl = computed(() => {
  const render = renderImage.value;
  if (!render) return null;
  if (props.viewMode && render.status !== "approved") return null;
  // Pending renders live in local storage (not yet on R2), so force the backend URL.
  return buildImageUrl(render.filename, render.status !== "approved");
});

const renderImageCrossorigin = computed(() =>
  renderImageUrl.value && imageRequiresCredentials(renderImageUrl.value)
    ? "use-credentials"
    : undefined,
);

// Wikidata entity for the current project (logo, description, height)
const wikidataId = computed(() => {
  const p = props.project?.externalProperties;
  if (!p || typeof p !== "object") return null;
  const id = (p as Record<string, unknown>)["wikidata"];
  return typeof id === "string" ? id : null;
});
const { entity: wikidataEntity } = useWikidataEntity(wikidataId);

function handleDrawShapesClick() {
  if (isMobile.value) {
    toast.add({
      severity: "warn",
      summary: $t("shapes.desktopOnly"),
      life: 3000,
    });
    return;
  }
  emit("draw-shapes", props.project);
}

// Check if project/overlay is published to backend (null status means not yet submitted)
const hasChanges = computed(() => {
  if (props.overlay && isOverlayUnsaved(props.overlay)) return true;
  if (props.project && isProjectUnsaved(props.project)) return true;
  return false;
});

function handlePublishClick() {
  if (props.overlay) {
    emit("publish-overlay");
  } else {
    emit("publish-project");
  }
}

// Computed property for delete button visibility
const canDeleteProject = computed(() => {
  if (!props.project || !user.value || props.viewMode) return false;
  const isDeletable = props.project.status === null || props.project.status === "pending";
  const isOwner = props.project.ownerId === user.value.id;
  return isDeletable && isOwner;
});
</script>

<style scoped>
/* Entrance animation for overlay-source popup (resting transform: translateY(20px)) */
@keyframes popup-enter-overlay {
  from {
    opacity: 0;
    transform: translateY(20px) scaleY(0.4);
  }
  to {
    opacity: 1;
    transform: translateY(20px) scaleY(1);
  }
}

/* Arrow pointing to the triggering element */
.unified-popup::before {
  content: "";
  position: absolute;
  width: 0;
  height: 0;
}

/* Positioning for overlay toolbar source */
.popup-source-overlay {
  transform: translateY(20px);
  animation: popup-enter-overlay 0.25s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
  transform-origin: top left;
}

.popup-source-overlay::before {
  top: -8px;
  left: 10px;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 10px solid var(--p-content-background);
}

/* --- Marker source: placement-aware positioning --- */

/* down: popup opens below anchor, arrow at top center */
@keyframes popup-enter-down {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px) scaleY(0.4);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(20px) scaleY(1);
  }
}
.popup-source-marker.popup-placement-down {
  transform: translateX(-50%) translateY(20px);
  animation: popup-enter-down 0.25s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
  transform-origin: top center;
}
.popup-source-marker.popup-placement-down::before {
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 10px solid var(--p-content-background);
}

/* up: popup opens above anchor, arrow at bottom center */
@keyframes popup-enter-up {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(calc(-100% - 20px)) scaleY(0.4);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(calc(-100% - 20px)) scaleY(1);
  }
}
.popup-source-marker.popup-placement-up {
  transform: translateX(-50%) translateY(calc(-100% - 20px));
  animation: popup-enter-up 0.25s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
  transform-origin: bottom center;
}
.popup-source-marker.popup-placement-up::before {
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-top: 10px solid var(--p-content-background);
}

/* right: popup opens to the right of anchor, arrow on left side */
@keyframes popup-enter-right {
  from {
    opacity: 0;
    transform: translateX(20px) translateY(-50%) scaleX(0.4);
  }
  to {
    opacity: 1;
    transform: translateX(20px) translateY(-50%) scaleX(1);
  }
}
.popup-source-marker.popup-placement-right {
  transform: translateX(20px) translateY(-50%);
  animation: popup-enter-right 0.25s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
  transform-origin: left center;
}
.popup-source-marker.popup-placement-right::before {
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  border-top: 10px solid transparent;
  border-bottom: 10px solid transparent;
  border-right: 10px solid var(--p-content-background);
}

/* left: popup opens to the left of anchor, arrow on right side */
@keyframes popup-enter-left {
  from {
    opacity: 0;
    transform: translateX(calc(-100% - 20px)) translateY(-50%) scaleX(0.4);
  }
  to {
    opacity: 1;
    transform: translateX(calc(-100% - 20px)) translateY(-50%) scaleX(1);
  }
}
.popup-source-marker.popup-placement-left {
  transform: translateX(calc(-100% - 20px)) translateY(-50%);
  animation: popup-enter-left 0.25s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
  transform-origin: right center;
}
.popup-source-marker.popup-placement-left::before {
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  border-top: 10px solid transparent;
  border-bottom: 10px solid transparent;
  border-left: 10px solid var(--p-content-background);
}
</style>

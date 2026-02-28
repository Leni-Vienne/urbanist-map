<template>
  <div
    :class="['unified-popup', `popup-source-${props.source}`]"
    class="p-4 w-[300px] min-h-[200px] bg-[var(--p-surface-0)] cursor-text select-text rounded-xl shadow-[var(--p-shadow-md)] pointer-events-auto relative z-[1000]"
    @click.stop
  >
    <div v-if="loading" class="flex justify-center items-center h-[200px]">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div v-else class="project-details">
      <!-- Project Information Section -->
      <ProjectMetadataCard
        :project="project"
        :show-description="true"
        :show-coordinates="!overlay"
        :edit-mode="!viewMode"
        :available-cities="availableCities"
        @field-click="emit('edit-project', project)"
      >
        <template #actions="{ project }">
          <!-- AI : Edit button (owned = direct edit, non-owned = suggest changes) -->
          <Button
            v-if="!viewMode && project && user"
            icon="pi pi-pencil"
            :class="['p-button-sm', 'p-button-text']"
            @click="emit('edit-project', project)"
            v-tooltip.top="
              project.ownerId === user.id ? $t('project.edit') : $t('tooltips.suggestChanges')
            "
          />
          <!-- AI : Delete button (for unsubmitted projects or pending projects owned by user) -->
          <Button
            v-if="canDeleteProject"
            icon="pi pi-trash"
            :class="['p-button-sm', 'p-button-text', 'p-button-danger']"
            @click="emit('delete-project', project)"
            v-tooltip.top="$t('contribute.deleteProject')"
          />
          <!-- AI : Close button (only for project-only view) -->
          <Button
            v-if="!overlay"
            icon="pi pi-times"
            class="p-button-sm p-button-text p-button-secondary"
            @click="emit('close-popup')"
            v-tooltip.top="$t('common.close')"
          />
        </template>
      </ProjectMetadataCard>

      <!-- Overlay Information Section (only if viewing an overlay) -->
      <div v-if="overlay" class="mt-4">
        <div class="section-header-row">
          <div class="section-header">{{ $t("overlay.overlayInformation") }}</div>
          <div class="flex gap-1">
            <!-- AI : Edit button (owned = direct edit, non-owned = suggest changes) -->
            <Button
              v-if="!viewMode && user"
              icon="pi pi-pencil"
              :class="['p-button-sm', 'p-button-text']"
              @click="emit('edit-overlay', overlay)"
              v-tooltip.top="
                overlay.authorId === user.id
                  ? $t('tooltips.editOverlay')
                  : $t('tooltips.suggestChanges')
              "
            />
            <!-- AI : Delete button (only for pending overlays owned by user) -->
            <Button
              v-if="
                !viewMode && user && overlay.status === 'pending' && overlay.authorId === user.id
              "
              icon="pi pi-trash"
              :class="['p-button-sm', 'p-button-text', 'p-button-danger']"
              @click="emit('delete-overlay', overlay)"
              v-tooltip.top="$t('contribute.deleteOverlay')"
            />
          </div>
        </div>

        <div class="info-card">
          <div class="info-row">
            <span class="info-label">{{ $t("common.name") }}:</span>
            <span v-if="overlay.caption" class="info-value">{{ overlay.caption }}</span>
            <button
              v-else-if="!viewMode"
              class="ml-auto text-xs italic text-[var(--p-primary-400)] hover:text-[var(--p-primary-600)] cursor-pointer bg-transparent border-none p-0 outline-none"
              @click="emit('edit-overlay', overlay)"
            >
              + {{ $t("common.addField") }}
            </button>
            <span v-else class="info-value">—</span>
          </div>
          <!-- AI : Show view original button for pending replacements -->
          <div
            v-if="overlay.replacesOverlayId && overlay.status === 'pending'"
            class="mt-2 pt-2 border-t border-[var(--p-surface-200)]"
          >
            <button
              class="inline-flex items-center gap-2 font-medium text-sm text-[var(--p-purple-600)] bg-[var(--p-purple-50)] border border-[var(--p-purple-200)] rounded-md cursor-pointer px-3 py-1.5 transition-all w-full justify-center hover:bg-[var(--p-purple-100)] hover:border-[var(--p-purple-300)] hover:text-[var(--p-purple-700)]"
              @click.stop="emit('view-original-overlay', overlay.replacesOverlayId)"
            >
              <i class="pi pi-arrow-left text-sm"></i>
              {{ $t("overlay.viewOriginalOverlay") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions Section - Edit mode buttons -->
    <div v-if="!viewMode" class="mt-4 flex gap-2 items-stretch">
      <Button
        class="flex-1"
        :label="
          isPublishedToBackend
            ? $t('project.submitChangeRequest')
            : overlay
              ? $t('overlay.publishOverlay')
              : $t('project.publish')
        "
        :icon="isPublishedToBackend ? 'pi pi-send' : 'pi pi-cloud-upload'"
        :severity="isPublishedToBackend ? 'info' : 'success'"
        :loading="publishLoading"
        :disabled="!hasChanges"
        @click="handlePublishClick"
      />
      <Button
        class="flex-1"
        :label="$t('project.addImages')"
        severity="secondary"
        outlined
        @click="emit('add-images')"
      >
        <template #icon>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
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
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/authStore";
import { useI18n } from "vue-i18n";
import type { OverlayObject, Project } from "@/types/index";
import ProjectMetadataCard from "@/components/map/popups/ProjectMetadataCard.vue";

const { t: $t } = useI18n();

interface Props {
  project: Project;
  overlay?: OverlayObject | null;
  viewMode?: boolean;
  publishLoading?: boolean;
  loading?: boolean;
  availableCities?: { id: number; name: string; countryCode: string }[];
  // AI : Source determines popup positioning - overlay toolbar vs project marker
  source?: "overlay" | "marker";
}

const props = withDefaults(defineProps<Props>(), {
  overlay: null,
  viewMode: false,
  publishLoading: false,
  loading: false,
  availableCities: () => [],
  source: "overlay",
});

const emit = defineEmits<{
  "edit-project": [project: Project];
  "edit-overlay": [overlay: OverlayObject];
  "publish-overlay": [];
  "publish-project": [];
  "close-popup": [];
  "add-images": [];
  "view-original-overlay": [overlayId: string];
  "delete-project": [project: Project];
  "delete-overlay": [overlay: OverlayObject];
}>();

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

// AI : Import pending modifications store for unified change detection
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
const pendingModsStore = usePendingModificationsStore();

// AI : Check if project/overlay is published to backend (null status means not yet submitted)
const isPublishedToBackend = computed(() => {
  if (props.overlay) {
    return props.overlay.status === "approved" || props.overlay.status === "pending";
  }
  return (
    props.project?.status !== null &&
    (props.project?.status === "approved" || props.project?.status === "pending")
  );
});

// AI : Check if overlay or project has changes that need to be published
// AI : Unified check: uses BOTH prop-based isModified AND pendingModificationsStore
const hasChanges = computed(() => {
  // AI : Check new unified store first (for caption/position changes)
  if (props.overlay && pendingModsStore.hasPendingModifications(props.overlay.id)) {
    return true;
  }
  // AI : Check project's overlays in pending mods store
  if (props.project && pendingModsStore.getModificationCountForProject(props.project.id) > 0) {
    return true;
  }
  // AI : Fallback to old prop-based isModified flags
  const overlayModified = props.overlay?.isModified ?? false;
  const projectModified = props.project?.isModified ?? false;
  return overlayModified || projectModified || !isPublishedToBackend.value;
});

// AI : Handle publish button click
function handlePublishClick() {
  if (props.overlay) {
    emit("publish-overlay");
  } else {
    emit("publish-project");
  }
}

// AI : Computed property for delete button visibility
const canDeleteProject = computed(() => {
  if (!props.project || !user.value || props.viewMode) return false;
  const isDeletable = props.project.status === null || props.project.status === "pending";
  const isOwner = props.project.ownerId === user.value.id;
  return isDeletable && isOwner;
});
</script>

<style scoped>
@import "../../../assets/info-card-shared.css";

/* AI : Arrow pointing to the triggering element */
.unified-popup::before {
  content: "";
  position: absolute;
  top: -8px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 10px solid var(--p-surface-0);
}

/* AI : Positioning for overlay toolbar source */
.popup-source-overlay {
  transform: translateY(20px);
}

.popup-source-overlay::before {
  left: 10px;
}

/* AI : Positioning for project marker source */
.popup-source-marker {
  transform: translateX(-50%) translateY(20px);
}

.popup-source-marker::before {
  left: 50%;
  transform: translateX(-50%);
}
</style>

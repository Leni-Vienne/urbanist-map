<template>
  <div
    :class="['unified-popup', `popup-source-${props.source}`]"
    class="w-75 min-h-50 bg-content-background cursor-text select-text rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_6px_rgba(0,0,0,0.06)] pointer-events-auto relative z-1000"
    @click.stop
  >
    <div v-if="loading" class="flex justify-center items-center h-50 p-4">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div v-else>
      <!-- Project header: project name + action buttons -->
      <div class="px-4 pt-3 pb-2 border-b border-surface">
        <div :class="['flex gap-2', overlay ? 'items-start' : 'items-center']">
          <!-- Left: project name stacked above overlay subtitle -->
          <div class="flex-1 flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-semibold text-color leading-snug">
              {{ project?.name || "—" }}
            </span>
            <!-- Overlay subtitle: image name or untitled + text "modifier" link -->
            <div v-if="overlay" class="flex items-baseline gap-1.5">
              <span class="text-xs italic text-muted-color leading-snug">
                {{ overlay.caption || $t("overlay.untitled") }}
              </span>
              <button
                v-if="!viewMode && user"
                class="text-xs italic text-primary-400 hover:text-primary-700 dark:hover:text-primary-200 cursor-pointer bg-transparent border-none p-0 outline-none shrink-0"
                @click="emit('edit-overlay', overlay)"
              >
                {{ $t("common.edit") }}
              </button>
              <button
                v-if="
                  !viewMode && user && overlay.status === 'pending' && overlay.authorId === user.id
                "
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
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
              @click="emit('delete-project', project)"
              v-tooltip.top="$t('contribute.deleteProject')"
            >
              <i class="pi pi-trash"></i>
            </button>
            <!-- Close button (only for project-only view) -->
            <button
              v-if="!overlay"
              class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-muted-color hover:text-color hover:bg-content-hover-background"
              @click="emit('close-popup')"
              v-tooltip.top="$t('common.close')"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Project fields + overlay section -->
      <div class="px-4 pt-3 pb-4">
        <ProjectMetadataCard
          :project="project"
          :show-name="false"
          :show-description="true"
          :edit-mode="!viewMode"
          :available-cities="availableCities"
          @field-click="emit('edit-project', project)"
        />

        <!-- Show view original button for pending replacements -->
        <div
          v-if="overlay?.replacesOverlayId && overlay?.status === 'pending'"
          class="mt-3 pt-3 border-t border-surface"
        >
          <button
            class="inline-flex items-center gap-2 font-medium text-sm text-purple-600 bg-purple-50 border border-purple-200 rounded-md cursor-pointer px-3 py-1.5 transition-all w-full justify-center hover:bg-purple-100 hover:border-purple-300 hover:text-purple-700"
            @click.stop="emit('view-original-overlay', overlay.replacesOverlayId)"
          >
            <i class="pi pi-arrow-left text-sm"></i>
            {{ $t("overlay.viewOriginalOverlay") }}
          </button>
        </div>
      </div>
    </div>

    <!-- Actions Section - Edit mode buttons -->
    <div v-if="!viewMode" class="px-4 pb-4 pt-3 flex gap-2 items-stretch border-t border-surface">
      <Button
        class="flex-1"
        :label="$t('project.submitChangeRequest')"
        icon="pi pi-send"
        severity="success"
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
  // Source determines popup positioning - overlay toolbar vs project marker
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

// Import pending modifications store for unified change detection
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
const pendingModsStore = usePendingModificationsStore();

// Check if project/overlay is published to backend (null status means not yet submitted)
const isPublishedToBackend = computed(() => {
  if (props.overlay) {
    return props.overlay.status === "approved" || props.overlay.status === "pending";
  }
  return (
    props.project?.status !== null &&
    (props.project?.status === "approved" || props.project?.status === "pending")
  );
});

// Check if overlay or project has changes that need to be published
// Unified check: uses BOTH prop-based isModified AND pendingModificationsStore
const hasChanges = computed(() => {
  // Check new unified store first (for caption/position changes)
  if (props.overlay && pendingModsStore.hasPendingModifications(props.overlay.id)) {
    return true;
  }
  // Check project's overlays in pending mods store
  if (props.project && pendingModsStore.getModificationCountForProject(props.project.id) > 0) {
    return true;
  }
  // Fallback to old prop-based isModified flags
  const overlayModified = props.overlay?.isModified ?? false;
  const projectModified = props.project?.isModified ?? false;
  return overlayModified || projectModified || !isPublishedToBackend.value;
});

// Handle publish button click
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
/* Arrow pointing to the triggering element */
.unified-popup::before {
  content: "";
  position: absolute;
  top: -8px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 10px solid var(--p-content-background);
}

/* Positioning for overlay toolbar source */
.popup-source-overlay {
  transform: translateY(20px);
}

.popup-source-overlay::before {
  left: 10px;
}

/* Positioning for project marker source */
.popup-source-marker {
  transform: translateX(-50%) translateY(20px);
}

.popup-source-marker::before {
  left: 50%;
  transform: translateX(-50%);
}
</style>

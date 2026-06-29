<template>
  <!-- Full panel for authenticated users -->
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    :change-requests="pendingChangeRequests"
    :show-edit-buttons="true"
    :selected-project-id="selectedProjectId"
    :pinned-external-project="pinnedExternalProject"
    :keep-content-visible="allContributions.length > 0"
    @external-project-click="handleExternalProjectClick"
    is-contribute-panel
    :empty-message="
      allContributions.length > 0 && filteredProjects.length === 0
        ? $t('contribute.noProjectsMatchFilter')
        : $t('contribute.noProjectsFound')
    "
    :empty-sub-message="
      allContributions.length > 0 && filteredProjects.length === 0
        ? $t('contribute.tryChangingFilters')
        : $t('contribute.createFirstProject')
    "
  >
    <!-- isExternal: own projects can be deleted; external (non-owned) ones only allow suggesting changes -->
    <template #project-actions="{ project, isExternal }">
      <ProjectActionButtons
        :project="project"
        show-edit
        show-add-image
        show-draw
        show-save
        :show-delete="!isExternal"
        :is-modified="isProjectModified(project.id)"
        @edit="handleEditProjectClick"
        @add-image="handleAddImageToProject"
        @draw="handleDrawShapesClick"
        @save="handleSaveProjectClick"
        @delete="handleDeleteProjectClick"
      />
    </template>

    <template #overlay-actions="{ overlay }">
      <!-- Edit button - hide for replaced overlays and not-yet-submitted staged renders -->
      <button
        v-if="overlay.status !== 'replaced' && !isStagedRenderOverlay(overlay)"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-primary-color hover:text-primary-hover-color hover:bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--p-primary-color)_40%,transparent)]"
        @click.stop="handleEditOverlayClick(overlay)"
        v-tooltip.top="$t('tooltips.editOverlay')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <!-- Show delete for drafts (null/undefined), pending, or rejected overlays -->
      <button
        v-if="!overlay.status || overlay.status === 'pending' || overlay.status === 'rejected'"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-400/12 hover:border-red-200 dark:hover:border-red-400/40"
        @click.stop="handleDeleteOverlayClick(overlay)"
        v-tooltip.top="$t('contribute.deleteOverlay')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <button
        v-if="change.status === 'pending' || change.status === 'conflicted'"
        class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-400/12 hover:border-red-200 dark:hover:border-red-400/40"
        @click.stop="handleDeleteChangeRequestClick(change)"
        v-tooltip.top="$t('contribute.deleteChangeRequest')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </template>

    <template #empty-state>
      <p
        v-if="allContributions.length === 0"
        class="text-sm text-muted-color mt-3 max-w-65 leading-relaxed"
      >
        {{ $t("contribute.guest.description") }}
      </p>
      <Button
        @click="handleNewProjectClick"
        severity="primary"
        size="small"
        icon="pi pi-plus"
        :label="$t('common.add')"
        class="font-semibold mt-4"
        v-tooltip.bottom="$t('dialog.createNewProject')"
      />
    </template>

    <!-- Controls below the selected project: "New" button and the status filter tabs -->
    <template #contributions-header>
      <div class="flex flex-col gap-3 pt-1 pb-1">
        <div class="flex items-center justify-between gap-4">
          <span
            v-if="allContributions.length > 0"
            class="text-[0.75rem] font-semibold text-primary-color uppercase tracking-wide"
          >
            {{ $t("contribute.yourContributions") }}
          </span>
          <Button
            @click="handleNewProjectClick"
            severity="primary"
            size="small"
            icon="pi pi-plus"
            :label="$t('common.add')"
            class="font-semibold ml-auto"
            v-tooltip.bottom="$t('dialog.createNewProject')"
          />
        </div>
        <div v-if="allContributions.length > 0" class="flex items-center gap-2">
          <button
            v-for="tab in filterTabs"
            :key="tab.key"
            type="button"
            @click="activeFilter = tab.key"
            :class="[
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors duration-150',
              activeFilter === tab.key
                ? 'bg-[color-mix(in_srgb,var(--p-primary-color)_12%,transparent)] border-primary-color text-primary-color font-semibold'
                : 'bg-transparent border-surface text-muted-color hover:text-color hover:bg-content-hover-background',
            ]"
          >
            <span>{{ tab.label }}</span>
            <span
              class="text-xs"
              :class="
                activeFilter === tab.key ? 'text-primary-color opacity-70' : 'text-muted-color'
              "
            >
              {{ tab.count }}
            </span>
          </button>
        </div>
      </div>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { isOverlayUnsaved, isProjectUnsaved } from "@/utils/unsavedState";

import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { startShapeEditing } from "@/services/shape/shapeEditorLazy";
import { selectProject } from "@/services/map/projectSelection";
import { flyToGeometry } from "@/services/map/mapNavigation";
import type { ChangeRequest } from "@/stores/pinia/changeRequestStore";
import type {
  Project,
  ProjectForModeration,
  UserContribution,
  UserContributionOverlay,
  OverlayForModeration,
} from "@/types/index";
import { createOverlayForModeration, createStagedRenderOverlay } from "@/utils/projectFactories";
import { createProjectObject, convertOverlayToData } from "@/utils/typeFactories";
import { getStagedRender, clearStagedRender } from "@/composables/submission/stagedRenderStore";
import { useAuthStore } from "@/stores/authStore";

import ProjectAccordionPanel from "@/components/layout/ProjectAccordionPanel.vue";
import ProjectActionButtons from "@/components/project/ProjectActionButtons.vue";

const { t } = useI18n();

const { isLoading, fetchUserContributions, allContributions } = useUserContributions();

const { handleDeleteOverlay, handleDeleteProject } = useProjectDeletion();

const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const authStore = useAuthStore();

const { prepareSubmission } = useSubmissionDialog();

// Filter state - which status group of contributions to show
type ContributionFilter = "all" | "pending" | "approved";
const activeFilter = ref<ContributionFilter>("all");

// Opens the auth modal when unauthenticated, else the marker bar.
const { handleNewProjectClick } = useNewProject();

const toast = useToast();
const { isMobile } = useIsMobile();

const { pendingChangeRequests, refreshPendingChangeRequests, deleteChangeRequest } =
  useChangeRequests();

// Tracks the project behind the selected card. Sourced from whichever signals a selection:
// - the standalone project detail (shape / vector footprint click)
// - a selected overlay (selectOverlay closes the detail, so we read the project from the overlay)
// When neither is set (e.g. a background-map click closed the detail), it clears so the card
// disappears, mirroring view mode where clicking the map drops the selection.
const lastSelectedProject = ref<Project | null>(null);

watchEffect(() => {
  const detailProject = uiStore.projectDetail.project;
  if (detailProject) {
    lastSelectedProject.value = detailProject;
    return;
  }
  const overlayId = overlayStore.idSelectedOverlay;
  if (overlayId) {
    const overlay = overlayStore.overlays[overlayId];
    const joinedProject = overlay?.project;
    if (joinedProject) {
      lastSelectedProject.value = createProjectObject(
        joinedProject as Parameters<typeof createProjectObject>[0],
      );
      return;
    }
    // A locally-added overlay (e.g. an image just added to a tile-only OSM project) carries no
    // joined project, so resolve it by id from the store. If even that fails, keep the project
    // already selected: the selected overlay belongs to it, and clearing would collapse the card.
    const resolved = overlay?.projectId ? projectStore.getProjectById(overlay.projectId) : null;
    if (resolved) {
      lastSelectedProject.value = resolved;
    }
    return;
  }
  lastSelectedProject.value = null;
});

const selectedProjectId = computed(() => lastSelectedProject.value?.id ?? null);

// If the selected project is not in the user's contributions, expose it as an external pinned project
// so ContributePanel can show it at top as a read-only context card
const pinnedExternalProject = computed<ProjectForModeration | null>(() => {
  const id = selectedProjectId.value;
  if (!id) return null;
  const project = lastSelectedProject.value;
  if (!project) return null;
  // Own vs external can only be told apart once the user's contributions have loaded: the object
  // selected from the map carries no ownerId to shortcut the check. Until the list is loaded, render
  // nothing rather than guessing, otherwise an own project flashes as an external card and then jumps
  // into the accordion when the list arrives.
  if (!projectStore.userContributionsLoaded) return null;
  if (allContributions.value.some((p) => p.id === id)) return null;
  const overlays = Object.values(overlayStore.overlays)
    .filter((o) => o.projectId === project.id)
    .map((o) => createOverlayForModeration(convertOverlayToData(o)));
  // Renders live only in stagedRenderStore (not overlayStore), so surface a staged render here
  // as a pending render entry until it is submitted.
  const stagedRender = getStagedRender(project.id);
  if (stagedRender) {
    overlays.push(
      createStagedRenderOverlay(
        project.id,
        stagedRender.previewUrl,
        authStore.user?.id ?? null,
        authStore.user?.username ?? null,
      ),
    );
  }
  return { ...project, overlays };
});

// A contribution counts as "pending" when its own status is unresolved, or any of its overlays
// or change requests are still awaiting moderation. Everything else is "approved" (resolved).
function isContributionPending(project: UserContribution): boolean {
  // Treat unsaved/unsubmitted projects (status === null) as pending
  const isPending = project.status === "pending" || project.status === null;

  const hasPendingOverlays =
    project.overlays?.some(
      (overlay: UserContributionOverlay) => overlay.status === "pending" || overlay.status === null,
    ) ?? false;
  const hasPendingChanges = pendingChangeRequests.value.some((change) => {
    if (change.entityType === "project" && change.entityId === project.id) {
      return true;
    }
    return (
      project.overlays?.some(
        (overlay: UserContributionOverlay) =>
          change.entityType === "overlay" && change.entityId === overlay.id,
      ) ?? false
    );
  });

  return isPending || hasPendingOverlays || hasPendingChanges;
}

const pendingCount = computed(
  () => allContributions.value.filter((project) => isContributionPending(project)).length,
);
const approvedCount = computed(() => allContributions.value.length - pendingCount.value);

const filterTabs = computed<{ key: ContributionFilter; label: string; count: number }[]>(() => [
  { key: "all", label: t("contribute.filterAll"), count: allContributions.value.length },
  { key: "pending", label: t("approvalStatus.pending"), count: pendingCount.value },
  { key: "approved", label: t("approvalStatus.approved"), count: approvedCount.value },
]);

const filteredProjects = computed(() => {
  if (activeFilter.value === "all") {
    return allContributions.value;
  }
  if (activeFilter.value === "pending") {
    return allContributions.value.filter((project) => isContributionPending(project));
  }
  return allContributions.value.filter((project) => !isContributionPending(project));
});

// A render staged in the upload dialog but not yet submitted: kind 'render' with no status. Real
// renders always carry a server status, so this uniquely identifies a still-staged one.
function isStagedRenderOverlay(overlay: OverlayForModeration): boolean {
  return overlay.kind === "render" && !overlay.status;
}

// Handle delete overlay click - uses shared deletion composable
async function handleDeleteOverlayClick(overlay: OverlayForModeration) {
  // A staged render has no overlay row to delete: drop it from stagedRenderStore and clear the
  // project's modified flag unless other unsaved overlays remain.
  if (isStagedRenderOverlay(overlay) && overlay.projectId) {
    const projectId = overlay.projectId;
    clearStagedRender(projectId);
    const hasOtherUnsaved = Object.values(overlayStore.overlays).some(
      (o) => o.projectId === projectId && isOverlayUnsaved(o),
    );
    projectStore.updateProject(projectId, { isModified: hasOtherUnsaved });
    return;
  }

  await handleDeleteOverlay(overlay.id, overlay.caption);
}

async function handleDeleteProjectClick(project: ProjectForModeration) {
  await handleDeleteProject(project.id, project.name, project.overlays?.length ?? 0);
}

async function handleDeleteChangeRequestClick(change: ChangeRequest) {
  const fieldName = change.fieldName;
  const confirmed = confirm(t("contribute.confirmDeleteChangeRequest", { field: fieldName }));
  if (!confirmed) return;

  const result = await deleteChangeRequest(change.id);
  if (result) {
    toast.add({
      severity: "success",
      summary: t("contribute.changeRequestDeleted"),
      life: 3000,
    });
  }
}

function isOverlayModified(overlayId: string): boolean {
  const overlay = overlayStore.overlays[overlayId];
  return overlay ? isOverlayUnsaved(overlay) : false;
}

function handleEditOverlayClick(overlay: OverlayForModeration) {
  // Prefer the live store object so in-memory caption changes are not lost on reopen
  const liveOverlay = overlayStore.overlays[overlay.id];
  if (liveOverlay) {
    uiStore.openOverlayEditDialog(liveOverlay);
    return;
  }
  // Fallback: overlay not yet loaded in store (e.g. not on map)
  // Only id + caption are needed, openOverlayEditDialog accepts OverlayEditTarget
  uiStore.openOverlayEditDialog({
    id: overlay.id,
    caption: overlay.caption,
  });
}

function handleAddImageToProject(project: ProjectForModeration) {
  uiStore.openImageUploadDialog(project.id);
}

// Check if project or any of its overlays is modified
function isProjectModified(projectId: string): boolean {
  const projectInStore = projectStore.projects[projectId];
  if (projectInStore && isProjectUnsaved(projectInStore)) return true;

  // UserContribution.overlays may reference overlays in the live store under the same id.
  const project = allContributions.value.find((p: UserContribution) => p.id === projectId);
  return project?.overlays?.some((o: UserContributionOverlay) => isOverlayModified(o.id)) ?? false;
}

async function handleSaveProjectClick(project: ProjectForModeration) {
  if (!isProjectModified(project.id)) return;

  prepareSubmission(project);
}

// Handle draw shapes click, mirrors handleDrawShapesClick in ProjectDetailPanel
async function handleDrawShapesClick(project: ProjectForModeration) {
  if (isMobile.value) {
    toast.add({
      severity: "warn",
      summary: t("shapes.desktopOnly"),
      life: 3000,
    });
    return;
  }

  const approvedGeometry = project.geometry ?? null;

  // Close any open detail (overlay detail or standalone project detail) to ensure a clean slate
  if (overlayStore.overlayDetailVisible) {
    overlayStore.closeOverlayDetail();
  }
  if (uiStore.projectDetail.visible) {
    uiStore.closeProjectDetail();
  }

  // Open the shape editor panel (no detail to reopen at) and lazy-load the editor
  uiStore.openShapeEditor(project);
  await startShapeEditing(project.id, approvedGeometry);
}

// Navigate to the external pinned project using the same logic as a map click.
// The ProjectForModeration argument is intentionally ignored: it lacks geometry data.
// lastSelectedProject holds the full Project with lat/lng/geometry needed for navigation.
function handleExternalProjectClick(_project: ProjectForModeration) {
  const fullProject = lastSelectedProject.value;
  if (!fullProject) return;
  selectProject(fullProject);
  if (typeof fullProject.lat === "number" && typeof fullProject.lng === "number") {
    flyToGeometry([fullProject.lat, fullProject.lng], fullProject.geometrySizeM ?? 0);
  }
}

function handleEditProjectClick(project: ProjectForModeration) {
  // Get the latest project data from allContributions (not the potentially stale passed parameter)
  const latestProjectData = allContributions.value.find(
    (p: UserContribution) => p.id === project.id,
  );
  const projectToEdit = latestProjectData ?? project;

  if (projectToEdit.id && projectToEdit.status !== null && !projectToEdit.isModified) {
    projectStore.cacheProjectBackendState(projectToEdit.id);
  }

  uiStore.openProjectEditForm(projectToEdit as Project);
}

onMounted(() => {
  fetchUserContributions();
  refreshPendingChangeRequests();
});
</script>

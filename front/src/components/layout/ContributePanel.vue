<template>
  <!-- Full panel for authenticated users -->
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    :change-requests="changeRequestStore.pendingChangeRequests"
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
      <button
        v-if="
          (overlay.status === null ||
            overlay.status === 'pending' ||
            overlay.status === 'approved') &&
          !isStagedRenderOverlay(overlay)
        "
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
                : 'bg-transparent border-surface text-muted-color hover:text-color hover:bg-(--p-content-hover-background)',
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
import { computed, onMounted } from "vue";
import { refreshPendingChangeRequests } from "@/services/changes/changeRequests";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { useContributeActions } from "@/composables/project/useContributeActions";
import { useFocusStore } from "@/stores/focusStore";

import ProjectAccordionPanel from "@/components/layout/ProjectAccordionPanel.vue";
import ProjectActionButtons from "@/components/project/ProjectActionButtons.vue";

const focusStore = useFocusStore();

const {
  isLoading,
  fetchUserContributions,
  allContributions,
  pinnedExternalProject,
  activeFilter,
  filterTabs,
  filteredProjects,
} = useUserContributions();

const changeRequestStore = useChangeRequestStore();

const {
  isStagedRenderOverlay,
  isProjectModified,
  handleNewProjectClick,
  handleDeleteOverlayClick,
  handleDeleteProjectClick,
  handleDeleteChangeRequestClick,
  handleEditOverlayClick,
  handleAddImageToProject,
  handleSaveProjectClick,
  handleDrawShapesClick,
  handleExternalProjectClick,
  handleEditProjectClick,
} = useContributeActions(allContributions);

const selectedProjectId = computed(() => focusStore.selectedProject?.id ?? null);

onMounted(() => {
  fetchUserContributions();
  refreshPendingChangeRequests();
});
</script>

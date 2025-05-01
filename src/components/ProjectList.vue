<template>
  <div class="project-list">
    <div class="flex flex-col gap-2 mb-4">
      <div
        v-for="project in projectsList"
        :key="project.id"
        class="project-item flex justify-between items-center p-2 border rounded-md mb-2"
      >
        <div class="flex flex-col">
          <span class="font-bold">{{ project.name }}</span>
          <span class="text-sm text-gray-500">{{ project.overlayIds.length }} overlays</span>
        </div>
        <div class="flex gap-2">
          <Button
            icon="pi pi-eye"
            class="p-button-sm"
            @click="openProject(project.id, 'view')"
            v-tooltip.top="'View project overlays'"
          />
          <Button
            icon="pi pi-pencil"
            class="p-button-sm p-button-secondary"
            @click="openProject(project.id, 'edit')"
            v-tooltip.top="'Edit project details'"
          />
          <Button
            icon="pi pi-trash"
            class="p-button-sm p-button-danger"
            @click="confirmDeleteProject(project.id)"
            v-tooltip.top="'Delete project'"
          />
        </div>
      </div>
    </div>
    <Button
      label="Create New Project"
      icon="pi pi-plus"
      class="p-button-primary w-full"
      @click="createNewProject"
    />
  </div>

  <!-- Confirmation dialog for deleting project -->
  <Dialog
    v-model:visible="showDeleteDialog"
    header="Confirm Deletion"
    :modal="true"
    :closable="true"
  >
    <div class="p-4">
      <p>Are you sure you want to delete this project?</p>
      <p class="text-sm text-gray-500 mt-2">
        The overlays will remain but will no longer be associated with this project.
      </p>
    </div>
    <template #footer>
      <Button
        label="Cancel"
        icon="pi pi-times"
        @click="showDeleteDialog = false"
        class="p-button-text"
      />
      <Button
        label="Delete"
        icon="pi pi-trash"
        @click="deleteProject"
        class="p-button-danger"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { projects, deleteProjectById } from '../composables/useProjects';
import { useToast } from '../composables/useToast';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';
import type { ProjectManagerMode } from '../composables/useProjectManagerDialog';

const toast = useToast();
const { openProjectManager } = useProjectManagerDialog();

// Component state
const showDeleteDialog = ref(false);
const projectToDelete = ref<string | null>(null);

// Computed properties
const projectsList = computed(() => {
  return Object.values(projects.value);
});

function confirmDeleteProject(projectId: string) {
  projectToDelete.value = projectId;
  showDeleteDialog.value = true;
}

async function deleteProject() {
  if (!projectToDelete.value) return;

  try {
    await deleteProjectById(projectToDelete.value);
    toast.add({
      severity: 'success',
      summary: 'Project deleted',
      detail: 'The project has been successfully deleted',
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to delete project',
      life: 3000
    });
  }

  showDeleteDialog.value = false;
  projectToDelete.value = null;
}

function openProject(projectId: string, mode: ProjectManagerMode) {
  const project = projects.value[projectId];
  if (project) {
    openProjectManager(mode, projectId, project.name);
  }
}

function createNewProject() {
  openProjectManager('create');
}
</script>

<style scoped>
.project-list {
  padding: 1rem;
  max-width: 500px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
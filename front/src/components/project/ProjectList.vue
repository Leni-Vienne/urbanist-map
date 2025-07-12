<template>
  <div>
    <TreeTable :value="nodes" :filters="filters" filterMode="strict" class="mb-4"
      :globalFilterFields="['name', 'location']" sortField="name" :sortOrder="1" responsiveLayout="scroll">
      <template #header>
        <div class="flex justify-between">
          <h3 class="text-lg font-semibold">Projects by Location</h3>
          <span class="p-input-icon-left">
            <i class="pi pi-search" />
            <InputText v-model="filters['global'].value" placeholder="Search..." />
          </span>
        </div>
      </template>

      <Column field="name" header="Name" :expander="true">
        <template #body="{ node }">
          <div class="flex items-center">
            <div v-if="node.data.color" class="color-circle mr-2" :style="{ backgroundColor: node.data.color }"></div>
            <span :class="{ 'font-bold': !node.data.cityId }">{{ node.data.name }}</span>
          </div>
        </template>
      </Column>

      <Column field="location" header="Location">
        <template #body="{ node }">
          <span>{{ node.data.location }}</span>
        </template>
      </Column>

      <Column header="Overlays">
        <template #body="{ node }">
          <span v-if="node.data.overlayCount !== undefined">{{ node.data.overlayCount }}</span>
        </template>
      </Column>

      <Column header="Actions" :exportable="false" style="min-width: 100px">
        <template #body="{ node }">
          <div v-if="node.data.cityId" class="flex justify-center">
            <Button icon="pi pi-ellipsis-v" class="p-button-rounded p-button-text" @click="toggleMenu($event, node.data)"
              aria-haspopup="true" aria-controls="project_actions_menu" />
            <Menu ref="menu" id="project_actions_menu" :model="menuItems" :popup="true" />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="text-center p-4">
          <p>No projects found. Create your first project to get started.</p>
        </div>
      </template>
    </TreeTable>

    <Button label="Create New Project" icon="pi pi-plus" class="p-button-primary w-full" @click="createNewProject" />

    <Dialog v-model:visible="showDeleteDialog" header="Confirm Deletion" :modal="true" :closable="true">
      <div class="p-4">
        <p>Are you sure you want to delete this project?</p>
        <p class="text-sm text-gray-500 mt-2">
          The overlays will remain but will no longer be associated with this project.
        </p>
      </div>
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" @click="showDeleteDialog = false" class="p-button-text" />
        <Button label="Delete" icon="pi pi-trash" @click="deleteProject" class="p-button-danger" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';

import { countries, deleteProjectById } from '@composables/project/useProjects';
import { useToast } from '@composables/ui/useToast';
import type { ProjectManagerMode } from '@composables/project/useProjectManagerDialog';
import type { MenuItem } from 'primevue/menuitem';
import TreeTable from 'primevue/treetable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import Dialog from 'primevue/dialog';

const toast = useToast();
const router = useRouter();

const showDeleteDialog = ref(false);
const projectToDelete = ref<string | null>(null);
const menu = ref();
const filters = ref({
  'global': { value: null, matchMode: 'contains' },
});
const selectedProjectId = ref<string>('');
const menuItems = ref<MenuItem[]>([]);

const nodes = computed(() => {
  // AI : Add safety check to prevent errors when countries is undefined or empty
  if (!countries.value || !Array.isArray(countries.value)) {
    return [];
  }
  
  return countries.value.map(country => {
    // AI : Add safety check for cities array
    const cityNodes = (country.cities ?? []).map(city => {
      // AI : Add safety check for projects array
      const projectNodes = ((city as any).projects ?? []).map((project: any) => ({
        key: project.id,
        data: {
          ...project,
          name: project.title,
          location: `${city.name}, ${country.name}`,
          overlayCount: project.overlayIds?.length ?? 0
        }
      }));
      return {
        key: `${country.id}-${city.id}`,
        data: {
          name: city.name,
          location: country.name
        },
        children: projectNodes
      };
    });
    return {
      key: country.id,
      data: {
        name: country.name,
        location: ''
      },
      children: cityNodes
    };
  });
});

function toggleMenu(event: Event, data: any) {
  // AI : Add safety check to ensure data has an id
  if (!data || !data.id) {
    console.warn('AI : Invalid data passed to toggleMenu:', data);
    return;
  }
  
  selectedProjectId.value = data.id;
  menuItems.value = [
    {
      label: 'View Project',
      icon: 'pi pi-eye',
      command: () => {
        if (selectedProjectId.value) {
          openProject(selectedProjectId.value, 'view');
        }
      }
    },
    {
      label: 'Edit Project',
      icon: 'pi pi-pencil',
      command: () => {
        if (selectedProjectId.value) {
          openProject(selectedProjectId.value, 'edit');
        }
      }
    },
    { separator: true },
    {
      label: 'Delete Project',
      icon: 'pi pi-trash',
      className: 'p-error',
      command: () => {
        if (selectedProjectId.value) {
          confirmDeleteProject(selectedProjectId.value);
        }
      }
    }
  ];
  menu.value.toggle(event);
}

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
    console.error('AI : Failed to delete project:', error);
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
  if (mode === 'view') {
    router.push(`/projects/${projectId}`);
  } else if (mode === 'edit') {
    router.push(`/projects/${projectId}/edit`);
  }
}

function createNewProject() {
  router.push('/projects/create');
}
</script>

<style scoped>
.color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
</style>

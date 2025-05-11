<template>
  <div>
    <DataTable 
      :value="projectsList"
      stripedRows
      class="mb-4"
      responsiveLayout="scroll"
      :paginator="true" 
      :rows="5"
      :rowsPerPageOptions="[5, 10, 20]"
      filterDisplay="menu"
      :filters="filters"
      v-model:sortField="sortField"
      v-model:sortOrder="sortOrder"
      :globalFilterFields="['name']"
    >
      <template #header>
        <div class="flex justify-between">
          <h3 class="text-lg font-semibold">Projects</h3>
          <span class="p-input-icon-left">
            <i class="pi pi-search" />
            <InputText v-model="filters.global.value" placeholder="Search projects..." />
          </span>
        </div>
      </template>

      <Column field="name" header="Project Name" :sortable="true">
        <template #body="{ data }">
          <div class="flex items-center">
            <div class="color-circle mr-2" :style="{ backgroundColor: data.color }"></div>
            <div class="flex flex-col">
              <span class="font-bold">{{ data.name }}</span>
              <span class="text-sm text-gray-500">{{ data.overlayIds.length }} overlays</span>
            </div>
          </div>
        </template>
        <template #filter="{ filterModel, filterCallback }">
          <InputText 
            v-model="filterModel.value" 
            type="text" 
            @input="filterCallback()" 
            class="p-column-filter" 
            placeholder="Search by name"
          />
        </template>
      </Column>
      
      <Column field="location" header="Location" :sortable="true">
        <template #body="{ data }">
          <span>{{ data.location || 'Not specified' }}</span>
        </template>
      </Column>
      
      <Column header="Actions" :exportable="false" style="min-width: 100px">
        <template #body="{ data }">
          <div class="flex justify-center">
            <Button 
              icon="pi pi-ellipsis-v" 
              class="p-button-rounded p-button-text" 
              @click="toggleMenu($event, data)"
              aria-haspopup="true" 
              aria-controls="project_actions_menu"
            />
            <Menu 
              ref="menu" 
              id="project_actions_menu" 
              :model="menuItems" 
              :popup="true"
            />
          </div>
        </template>
      </Column>
      
      <template #empty>
        <div class="text-center p-4">
          <p>No projects found. Create your first project to get started.</p>
        </div>
      </template>
      
      <template #footer>
        <div class="flex justify-between">
          <div>{{ projectsList.length }} {{ projectsList.length === 1 ? 'project' : 'projects' }} total</div>
        </div>
      </template>
    </DataTable>
    
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
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { projects, deleteProjectById } from '../composables/useProjects';
import { useToast } from '../composables/useToast';
import { useRouterNavigation } from '../composables/useRouterNavigation';
import type { ProjectManagerMode } from '../composables/useProjectManagerDialog';
import type { MenuItem } from 'primevue/menuitem';

const toast = useToast();
const router = useRouter();
const { openProjectManager } = useRouterNavigation();

// AI : Component state
const showDeleteDialog = ref(false);
const projectToDelete = ref<string | null>(null);
const sortField = ref('name');
const sortOrder = ref(1);
const menu = ref();
const filters = ref({
  global: { value: null, matchMode: 'contains' },
  name: { value: null, matchMode: 'startsWith' },
  location: { value: null, matchMode: 'startsWith' }
});
// AI : Track the currently selected project for menu actions
const selectedProjectId = ref<string>('');
const menuItems = ref<MenuItem[]>([]);

// AI : Computed properties
const projectsList = computed(() => {
  return Object.values(projects.value);
});

// AI : Initialize filter when component mounts
onMounted(() => {
  initFilters();
});

// AI : Initialize filters
const initFilters = () => {
  filters.value = {
    global: { value: null, matchMode: 'contains' },
    name: { value: null, matchMode: 'startsWith' },
    location: { value: null, matchMode: 'startsWith' }
  };
};

// AI : Generate menu items for a specific project
function getMenuItems(project: any): MenuItem[] {
  // AI : Capture the project ID in a local constant to ensure it's correctly enclosed in the command closures
  const projectId = project.id;
  
  return [
    {
      label: 'View Project',
      icon: 'pi pi-eye',
      command: () => {
        openProject(projectId, 'view');
      }
    },
    {
      label: 'Edit Project',
      icon: 'pi pi-pencil',
      command: () => {
        openProject(projectId, 'edit');
      }
    },
    { separator: true },
    {
      label: 'Delete Project',
      icon: 'pi pi-trash',
      className: 'p-error',
      command: () => {
        confirmDeleteProject(projectId);
      }
    }
  ];
}

// AI : Toggle the popup menu
function toggleMenu(event: Event, data: any) {
  // AI : Store the current project ID before toggling the menu
  selectedProjectId.value = data.id;
  // AI : Update menu items with the selected project
  menuItems.value = [
    {
      label: 'View Project',
      icon: 'pi pi-eye',
      command: () => {
        openProject(selectedProjectId.value, 'view');
      }
    },
    {
      label: 'Edit Project',
      icon: 'pi pi-pencil',
      command: () => {
        openProject(selectedProjectId.value, 'edit');
      }
    },
    { separator: true },
    {
      label: 'Delete Project',
      icon: 'pi pi-trash',
      className: 'p-error',
      command: () => {
        confirmDeleteProject(selectedProjectId.value);
      }
    }
  ];
  // AI : Toggle the menu without mutating the model prop
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
  // AI : Utiliser le router pour naviguer vers la vue projet appropriée
  if (mode === 'view') {
    router.push(`/projects/${projectId}`);
  } else if (mode === 'edit') {
    router.push(`/projects/${projectId}/edit`);
  }
}

function createNewProject() {
  // AI : Utiliser le router pour naviguer vers la page de création de projet
  router.push('/projects/create');
}
</script>

<style scoped>
@import "tailwindcss";

/* Remove these styles as they're now handled by AppLayout */
.project-list {
  max-width: 900px;
  margin: 0 auto;
}

.color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

:deep(.p-datatable .p-datatable-header) {
  background-color: transparent;
  border: none;
  padding-left: 0;
}

:deep(.p-column-filter) {
  width: 100%;
}

/* AI : Style for the menu button */
:deep(.p-button-rounded) {
  width: 2.5rem;
  height: 2.5rem;
}
</style>
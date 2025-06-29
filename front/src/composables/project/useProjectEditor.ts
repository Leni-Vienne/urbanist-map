import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { 
  projects, 
  createProject, 
  updateProject,
  getOverlaysForProject 
} from '@composables/project/useProjects';
import { useToast } from '@composables/ui/useToast';
import { initialProjectName, setLastCreatedProject } from '@composables/ui/useRouterNavigation';
import { useProjectManagerDialog } from '@composables/project/useProjectManagerDialog';
import type { Project, OverlayObject } from '@types';

// AI : Main composable for project editor business logic
export function useProjectEditor(projectId: string, mode: 'edit' | 'view' | 'create') {
  const router = useRouter();
  const toast = useToast();
  const { inFileUploadFlow } = useProjectManagerDialog();

  // AI : Reactive state
  const editingProject = ref<Partial<Project>>({
    name: '',
    description: '',
    location: '',
    startDate: null,
    endDate: null,
    sourceUrl: '',
    overlayIds: [],
  });

  const projectOverlays = ref<OverlayObject[]>([]);

  // AI : Computed properties
  const currentProject = computed(() => 
    projectId ? projects.value[projectId] : null
  );

  // AI : Initialize project data based on mode
  const initializeProject = async () => {
    if (mode === 'create') {      editingProject.value = {
        name: initialProjectName.value,
        description: '',
        location: '',
        cityId: undefined, // AI : Initialize cityId as undefined
        startDate: null,
        endDate: null,
        sourceUrl: '',
        overlayIds: [],
      };
    } else if (projectId && projects.value[projectId]) {
      if (mode === 'edit') {
        editingProject.value = { ...projects.value[projectId] };
      }
      
      if (mode === 'view') {
        await loadProjectOverlays();
      }
    }
  };

  // AI : Load overlays for the current project
  const loadProjectOverlays = async () => {
    if (projectId) {
      projectOverlays.value = await getOverlaysForProject(projectId);
    }
  };

  // AI : Save project (create or update)
  const saveProject = async (projectData: Partial<Project>) => {
    if (!projectData.name) {
      toast.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: 'Project name is required',
        life: 3000
      });
      return;
    }

    try {
      const isExisting = !!projectData.id;
      const dataToSave = {
        name: projectData.name,
        description: projectData.description || '',
        location: projectData.location || '',
        cityId: projectData.cityId, // AI : Include cityId for foreign key relationship
        startDate: projectData.startDate ?? null,
        endDate: projectData.endDate ?? null,
        sourceUrl: projectData.sourceUrl || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let savedProjectId;
      if (isExisting) {
        await updateProject(projectData.id!, dataToSave);
        savedProjectId = projectData.id;
      } else {
        savedProjectId = await createProject(dataToSave);
        setLastCreatedProject(savedProjectId);
      }

      toast.add({
        severity: 'success',
        summary: isExisting ? 'Project updated' : 'Project created',
        detail: `Project "${projectData.name}" has been ${isExisting ? 'updated' : 'created'}`,
        life: 3000
      });

      // AI : Navigate based on context
      if (!isExisting && inFileUploadFlow.value) {
        router.back();
      } else {
        router.push(isExisting ? '/projects' : `/projects/${savedProjectId}`);
      }
    } catch (error) {
      console.error('Error saving project:', error);
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to save project',
        life: 3000
      });
    }
  };

  // AI : Utility function to format dates
  const formatDate = (date: Date | null): string => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  };

  return {
    // State
    editingProject,
    projectOverlays,
    currentProject,
    
    // Methods
    initializeProject,
    loadProjectOverlays,
    saveProject,
    formatDate
  };
}

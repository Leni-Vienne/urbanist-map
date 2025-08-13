import { ref, computed } from 'vue';
import { 
  useProjects,
  createProject, 
  updateProject,
  getOverlaysForProject 
} from '@composables/project/useProjects';
import { useToast } from '@composables/ui/useToast';
import { setLastCreatedProject } from '@composables/ui/useRouterNavigation';
import type { Project, OverlayObject } from '@types';

// AI : Options for customizing navigation behavior
export interface ProjectEditorOptions {
  onProjectSaved?: (projectId: string, isNewProject: boolean) => void;
  onCancel?: () => void;
}

// AI : Main composable for project editor business logic
export function useProjectEditor(
  projectId: string, 
  mode: 'edit' | 'view' | 'create',
  options: ProjectEditorOptions = {}
) {
  const toast = useToast();

  // AI : Get store refs using the composable pattern
  const { projects } = useProjects();

  // AI : Reactive state
  const editingProject = ref<Partial<Project>>({
    name: '',
    description: '',
    startDate: null,
    endDate: null,
    sourceUrl: '',
    latestUpdateOn: null,
    overlayIds: [],
  });

  const projectOverlays = ref<OverlayObject[]>([]);

  // AI : Computed properties
  const currentProject = computed(() => 
    projectId ? projects.value[projectId] : null
  );

  // AI : Initialize project data based on mode
  const initializeProject = async () => {
    if (mode === 'create') {
      editingProject.value = {
    name: '',
    description: '',
    cityId: undefined, // AI : Initialize cityId as undefined
    startDate: null,
    endDate: null,
    sourceUrl: '',
    latestUpdateOn: null,
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
      
      // AI : Extract PDF file for potential future upload, but don't include in main project data
      const sourcePdfFile = projectData.sourcePdf;
      
      const dataToSave = {
        name: projectData.name,
        description: projectData.description ?? '',
        cityId: projectData.cityId, // AI : Include cityId for foreign key relationship
        startDate: projectData.startDate ?? null,
        endDate: projectData.endDate ?? null,
        sourceUrl: projectData.sourceUrl ?? '',
        latestUpdateOn: projectData.latestUpdateOn ?? null
        // AI : Don't include sourcePdf File object in serialized data
      };

      let savedProjectId;
      if (isExisting && projectData.id) {
        await updateProject(projectData.id, dataToSave);
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

      // AI : Call the onProjectSaved callback if provided
      if (options.onProjectSaved) {
        options.onProjectSaved(savedProjectId, !isExisting);
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

import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { Project, HydratedProject, ContributionProject, LocalProject } from "@/types/index";
import type { AppMode } from "@shared/types";
import { hasProjectDetailFields } from "@/utils/typeFactories";

type ProjectDraft = Partial<Project> & Pick<Project, "id">;
type ProjectIndex = Record<string, Project>;

function toProject(contribution: ContributionProject): Project {
  const { overlays: _overlays, ...project } = contribution;
  return project;
}

function mergeProject(project: Project, draft: ProjectDraft | undefined): Project {
  return draft ? { ...project, ...draft } : project;
}

function hasDraftFields(draft: ProjectDraft): boolean {
  return Object.keys(draft).some((field) => field !== "id");
}

function isLocalProjectDraft(draft: ProjectDraft): draft is LocalProject {
  return draft.status === null;
}

export const useProjectStore = defineStore("project", () => {
  const persistedProjects = ref<ProjectIndex>({});
  const projectDrafts = ref<Record<string, ProjectDraft>>({});
  const userContributions = ref<ContributionProject[]>([]);
  const userContributionsLoading = ref(false);
  const userContributionsLoaded = ref(false);

  function getEffectiveProjects(): ProjectIndex {
    const effective: ProjectIndex = {};
    Object.assign(effective, persistedProjects.value);
    for (const [id, draft] of Object.entries(projectDrafts.value)) {
      const persisted = persistedProjects.value[id];
      if (persisted) effective[id] = mergeProject(persisted, draft);
      else if (isLocalProjectDraft(draft)) effective[id] = draft;
    }
    return effective;
  }

  const projects = computed<ProjectIndex>(getEffectiveProjects);

  function getPersistedProject(projectId: string): Project | null {
    return persistedProjects.value[projectId] ?? null;
  }

  function getProjectById(projectId: string): Project | null {
    const persisted = persistedProjects.value[projectId];
    const draft = projectDrafts.value[projectId];
    if (persisted) return mergeProject(persisted, draft);
    return draft && isLocalProjectDraft(draft) ? draft : null;
  }

  function hasProjectDraft(projectId: string): boolean {
    return projectDrafts.value[projectId] !== undefined;
  }

  function getMapProjectById(projectId: string, mode: AppMode): Project | null {
    if (mode === "edit") return getProjectById(projectId);
    return getPersistedProject(projectId);
  }

  function getHydratedProject(projectId: string): HydratedProject | null {
    const project = getProjectById(projectId);
    return project && hasProjectDetailFields(project) ? project : null;
  }

  function upsertProjectSummary(project: Project): Project {
    const current = persistedProjects.value[project.id];
    const stored = current ? { ...current, ...project } : project;
    persistedProjects.value[project.id] = stored;
    return mergeProject(stored, projectDrafts.value[project.id]);
  }

  function upsertHydratedProject(project: HydratedProject): HydratedProject {
    persistedProjects.value[project.id] = project;
    const merged = mergeProject(project, projectDrafts.value[project.id]);
    return hasProjectDetailFields(merged) ? merged : project;
  }

  function removeProject(projectId: string): void {
    // oxlint-disable-next-line no-dynamic-delete
    delete persistedProjects.value[projectId];
    // oxlint-disable-next-line no-dynamic-delete
    delete projectDrafts.value[projectId];
  }

  function setUserContributions(contributions: ContributionProject[]) {
    for (const contribution of contributions) upsertProjectSummary(toProject(contribution));
    userContributions.value = contributions;
    userContributionsLoaded.value = true;
  }

  function setUserContributionsLoading(loading: boolean) {
    userContributionsLoading.value = loading;
  }

  function addLocalProject(project: LocalProject) {
    if (getProjectById(project.id)) return;
    projectDrafts.value[project.id] = { ...project };
  }

  function updateProjectDraft(projectId: string, updates: Partial<Project>) {
    const current = getProjectById(projectId);
    if (!current) return;
    projectDrafts.value[projectId] = {
      ...(projectDrafts.value[projectId] ?? { id: projectId }),
      ...updates,
      id: projectId,
    };
  }

  function updatePersistedProject(projectId: string, updates: Partial<Project>) {
    const current = persistedProjects.value[projectId];
    if (!current) return;
    persistedProjects.value[projectId] = { ...current, ...updates };
  }

  function resetProjectField(projectId: string, fieldName: keyof Project): boolean {
    const draft = projectDrafts.value[projectId];
    if (!draft || !(fieldName in draft)) return false;
    // oxlint-disable-next-line no-dynamic-delete
    delete draft[fieldName];
    if (!hasDraftFields(draft)) {
      // oxlint-disable-next-line no-dynamic-delete
      delete projectDrafts.value[projectId];
    }
    return true;
  }

  function discardProjectDraft(projectId: string): void {
    // oxlint-disable-next-line no-dynamic-delete
    delete projectDrafts.value[projectId];
  }

  function clearAllState(): void {
    persistedProjects.value = {};
    projectDrafts.value = {};
    userContributions.value = [];
    userContributionsLoading.value = false;
    userContributionsLoaded.value = false;
  }

  return {
    persistedProjects,
    projectDrafts,
    projects,
    userContributions,
    userContributionsLoading,
    userContributionsLoaded,
    addLocalProject,
    upsertProjectSummary,
    upsertHydratedProject,
    removeProject,
    updateProjectDraft,
    updatePersistedProject,
    resetProjectField,
    discardProjectDraft,
    getPersistedProject,
    getProjectById,
    hasProjectDraft,
    getMapProjectById,
    getHydratedProject,
    setUserContributions,
    setUserContributionsLoading,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}

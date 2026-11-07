import { useSubmissionStore } from "@/stores/submissionStore";
import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { Project, HydratedProject, LocalProject } from "@/types/index";
import type { AppMode } from "@shared/types";
import { trpc } from "@/client";
import { hasProjectDetailFields, projectFromWire } from "@/utils/typeFactories";
import { projectValuesEqual } from "@/utils/projectValues";

type ProjectDraft = Partial<Project> & Pick<Project, "id">;
type ProjectIndex = Record<string, Project>;
type DetailStatus = "loading" | "ready" | "error" | "unavailable";

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
  const submissionStore = useSubmissionStore();
  const persistedProjects = ref<ProjectIndex>({});
  const projectDrafts = ref<Record<string, ProjectDraft>>({});
  const detailStatusById = ref<Record<string, DetailStatus>>({});
  const pendingDetails = new Map<string, Promise<HydratedProject | null>>();
  let detailGeneration = 0;

  async function fetchProjectDetail(projectId: string): Promise<HydratedProject | null> {
    const generation = detailGeneration;
    detailStatusById.value[projectId] = "loading";
    try {
      const fresh = await trpc.project.getById.query({ id: projectId });
      // A reset ends this cache's session, including requests still in flight.
      if (generation !== detailGeneration) return null;
      detailStatusById.value[projectId] = fresh ? "ready" : "unavailable";
      return fresh ? upsertHydratedProject(projectFromWire(fresh)) : null;
    } catch (error) {
      if (generation !== detailGeneration) return null;
      console.error("Failed to load project detail:", error);
      detailStatusById.value[projectId] = "error";
      return null;
    }
  }

  async function loadProjectDetail(projectId: string): Promise<HydratedProject | null> {
    const cached = getHydratedProject(projectId);
    if (cached || getProjectById(projectId)?.status === null) return cached;

    let request = pendingDetails.get(projectId);
    if (!request) {
      request = fetchProjectDetail(projectId);
      pendingDetails.set(projectId, request);
    }
    try {
      return await request;
    } finally {
      if (pendingDetails.get(projectId) === request) pendingDetails.delete(projectId);
    }
  }

  function getEffectiveProjects() {
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
    const draft = projectDrafts.value[projectId];
    if (!draft) return false;
    const persisted = persistedProjects.value[projectId];
    if (!persisted) return isLocalProjectDraft(draft);
    return Object.entries(draft).some(
      ([field, value]) =>
        field !== "id" && !projectValuesEqual(field, persisted[field as keyof Project], value),
    );
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

  function addLocalProject(project: LocalProject) {
    if (submissionStore.isSubmitting) return;
    if (getProjectById(project.id)) return;
    projectDrafts.value[project.id] = { ...project };
  }

  function updateProjectDraft(projectId: string, updates: Partial<Project>) {
    if (submissionStore.isSubmitting) return;
    const current = getProjectById(projectId);
    if (!current) return;
    const draft: ProjectDraft = {
      ...(projectDrafts.value[projectId] ?? { id: projectId }),
      ...updates,
      id: projectId,
    };
    const persisted = persistedProjects.value[projectId];
    if (persisted) {
      for (const field of Object.keys(draft) as (keyof Project)[]) {
        if (field !== "id" && projectValuesEqual(field, persisted[field], draft[field])) {
          // oxlint-disable-next-line no-dynamic-delete
          delete draft[field];
        }
      }
    }
    if (hasDraftFields(draft)) projectDrafts.value[projectId] = draft;
    else discardProjectDraft(projectId);
  }

  function updatePersistedProject(projectId: string, updates: Partial<Project>) {
    const current = persistedProjects.value[projectId];
    if (!current) return;
    persistedProjects.value[projectId] = { ...current, ...updates };
  }

  function resetProjectField(projectId: string, fieldName: keyof Project): boolean {
    if (submissionStore.isSubmitting) return false;
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
    detailGeneration += 1;
    pendingDetails.clear();
    detailStatusById.value = {};
    persistedProjects.value = {};
    projectDrafts.value = {};
  }

  return {
    persistedProjects,
    projectDrafts,
    detailStatusById,
    loadProjectDetail,
    projects,
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
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}

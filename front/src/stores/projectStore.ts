import { useSubmissionStore } from "@/stores/submissionStore";
import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, onScopeDispose, ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import type { Project, ProjectSummary, HydratedProject, LocalProject } from "@/types/index";
import type { AppMode } from "@shared/types";
import { trpc } from "@/client";
import { hasProjectDetailFields, projectFromWire } from "@/utils/typeFactories";
import { projectValuesEqual } from "@shared/projectValues";

type ProjectDraft = Partial<Project> & Pick<Project, "id">;
type ProjectIndex = Record<string, Project>;
type DetailStatus = "loading" | "ready" | "error" | "unavailable";

function mergeProject(project: Project, draft: ProjectDraft | undefined): Project {
  return draft ? { ...project, ...draft } : project;
}

// Summary freshness and detail completeness are independent: a newer project row does not
// carry a fresh gallery. Preserve the whole summary, taking detail fields only from the response.
function withProjectDetail(summary: ProjectSummary, detail: HydratedProject): HydratedProject {
  return {
    ...summary,
    slug: detail.slug,
    render: detail.render,
    mapOverlays: detail.mapOverlays,
    ownerUsername: detail.ownerUsername,
    boundaryPath: detail.boundaryPath,
  };
}

function hasDraftFields(draft: ProjectDraft): boolean {
  return Object.keys(draft).some((field) => field !== "id");
}

function isLocalProjectDraft(draft: ProjectDraft): draft is LocalProject {
  return draft.status === null;
}

export const useProjectStore = defineStore("project", () => {
  const submissionStore = useSubmissionStore();
  const authStore = useAuthStore();
  const persistedProjects = ref<ProjectIndex>({});
  const projectDrafts = ref<Record<string, ProjectDraft>>({});
  const detailStatusById = ref<Record<string, DetailStatus>>({});
  const pendingDetails = new Map<
    string,
    { controller: AbortController; promise: Promise<HydratedProject | null> }
  >();

  async function fetchProjectDetail(
    projectId: string,
    signal: AbortSignal,
  ): Promise<HydratedProject | null> {
    const epoch = authStore.getSessionEpoch();
    const userId = authStore.user?.id;
    const original = persistedProjects.value[projectId];
    function isCurrentRequest(): boolean {
      return (
        !signal.aborted && epoch === authStore.getSessionEpoch() && userId === authStore.user?.id
      );
    }
    detailStatusById.value[projectId] = "loading";
    try {
      const fresh = await trpc.project.getById.query({ id: projectId }, { signal });
      if (!isCurrentRequest()) return null;
      const current = persistedProjects.value[projectId];
      if (!fresh) {
        if (current && current !== original) {
          const hydrated = getHydratedProject(projectId);
          detailStatusById.value[projectId] = hydrated ? "ready" : "error";
          return hydrated;
        }
        removeProject(projectId);
        detailStatusById.value[projectId] = "unavailable";
        return null;
      }
      let project: HydratedProject = projectFromWire(fresh);
      // A summary accepted while loading wins ties. Compare snapshots, not individual values:
      // a newer edit may deliberately restore a field to its original value.
      if (
        current &&
        current !== original &&
        current.status !== null &&
        current.version >= project.version
      ) {
        project = withProjectDetail(current, project);
      }
      detailStatusById.value[projectId] = "ready";
      return upsertHydratedProject(project);
    } catch (error) {
      if (!isCurrentRequest()) return null;
      console.error("Failed to load project detail:", error);
      detailStatusById.value[projectId] = "error";
      return null;
    }
  }

  async function loadProjectDetail(
    projectId: string,
    force = false,
  ): Promise<HydratedProject | null> {
    if (force) {
      pendingDetails.get(projectId)?.controller.abort();
      pendingDetails.delete(projectId);
    }
    const cached = getHydratedProject(projectId);
    const status = detailStatusById.value[projectId];
    if (
      (!force && cached && status !== "error" && status !== "loading") ||
      getProjectById(projectId)?.status === null
    )
      return cached;

    let request = pendingDetails.get(projectId);
    if (!request) {
      const controller = new AbortController();
      request = { controller, promise: fetchProjectDetail(projectId, controller.signal) };
      pendingDetails.set(projectId, request);
    }
    try {
      return await request.promise;
    } finally {
      if (pendingDetails.get(projectId) === request) {
        pendingDetails.delete(projectId);
        if (detailStatusById.value[projectId] === "loading") {
          detailStatusById.value[projectId] = "error";
        }
      }
    }
  }

  function getEffectiveProjects() {
    const effective = { ...persistedProjects.value };
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
        field !== "id" && !projectValuesEqual(persisted[field as keyof Project], value),
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
    if (current && current.version > project.version)
      return mergeProject(current, projectDrafts.value[project.id]);
    // Selection may supply a complete cached project. A summary write must not restore its
    // old gallery; list metadata such as ownerUsername and boundaryPath can still be refreshed.
    const { slug: _slug, render: _render, mapOverlays: _mapOverlays, ...summary } = project;
    const stored = current ? { ...current, ...summary } : summary;
    persistedProjects.value[project.id] = stored;
    return mergeProject(stored, projectDrafts.value[project.id]);
  }

  function upsertHydratedProject(project: HydratedProject): HydratedProject {
    const current = persistedProjects.value[project.id];
    const stored =
      current && current.status !== null && current.version > project.version
        ? withProjectDetail(current, project)
        : project;
    persistedProjects.value[project.id] = stored;
    const merged = mergeProject(stored, projectDrafts.value[project.id]);
    return hasProjectDetailFields(merged) ? merged : stored;
  }

  function removeProject(projectId: string): void {
    pendingDetails.get(projectId)?.controller.abort();
    pendingDetails.delete(projectId);
    // oxlint-disable-next-line no-dynamic-delete
    delete detailStatusById.value[projectId];
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
        if (field !== "id" && projectValuesEqual(persisted[field], draft[field])) {
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
    for (const request of pendingDetails.values()) request.controller.abort();
    pendingDetails.clear();
    detailStatusById.value = {};
    persistedProjects.value = {};
    projectDrafts.value = {};
  }

  onScopeDispose(clearAllState);

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

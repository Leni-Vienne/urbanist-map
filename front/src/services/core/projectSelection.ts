import type { Project } from "@/types/index";
import { useProjectStore } from "@/stores/projectStore";
import { useFocusStore } from "@/stores/focusStore";
import { useUiStore } from "@/stores/uiStore";

/** Select a project immediately, even when its data has not been loaded yet. */
export function openProjectDetailById(projectId: string): void {
  const focus = useFocusStore();
  focus.setSelectionTarget({ kind: "project", projectId });
  focus.setHoverTarget(null);
}

/** Cache the supplied project summary before selecting its ID. */
export function openProjectDetail(project: Project): void {
  const projectStore = useProjectStore();

  // A project with a draft may be an effective projection. Do not copy its draft fields into the
  // persisted baseline.
  const current = projectStore.getProjectById(project.id);
  if (!current || !projectStore.hasProjectDraft(project.id))
    projectStore.upsertProjectSummary(project);
  openProjectDetailById(project.id);
}

/**
 * Enter edit mode with `project` pinned, so the contribute panel opens on it.
 */
export function openProjectForEditing(project: Project): void {
  useUiStore().setMode("edit");
  openProjectDetail(project);
}

import { reactive } from "vue";

// A render image staged in the project form, awaiting submission. The file bytes only upload
// once the user confirms in the submission dialog, like every other contribution. Keyed by
// project id so the staged render survives the form closing before the project is submitted.
// Reactive so the project detail can show the staged preview before submission.
export interface StagedRender {
  file: File;
  previewUrl: string;
}

const stagedRenders = reactive(new Map<string, StagedRender>());

export function setStagedRender(projectId: string, render: StagedRender): void {
  stagedRenders.set(projectId, render);
}

export function getStagedRender(projectId: string): StagedRender | undefined {
  return stagedRenders.get(projectId);
}

export function clearStagedRender(projectId: string): void {
  stagedRenders.delete(projectId);
}

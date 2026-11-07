import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";

// User-scoped drafts and confirmation state survive component and map remounts.
export const useSubmissionStore = defineStore("submission", () => {
  interface PendingSubmission {
    projectId: string;
    entityName: string | null;
    renderId?: string;
  }

  const pendingSubmission = ref<PendingSubmission | null>(null);
  const showSubmissionDialog = computed(() => pendingSubmission.value !== null);
  // Execution and the review target are independent: sign-out can close review while a request
  // still owns the lock. Only the execution that acquired it may release it.
  const activeExecution = ref<symbol | null>(null);
  const isSubmitting = computed(() => activeExecution.value !== null);

  function beginSubmission() {
    if (isSubmitting.value) return null;
    const execution = Symbol("submission");
    activeExecution.value = execution;
    return {
      finish(): void {
        if (activeExecution.value !== execution) return;
        activeExecution.value = null;
      },
    };
  }

  function clearPendingSubmission(): void {
    pendingSubmission.value = null;
  }

  // A render image staged in the project form, awaiting submission. The file bytes only upload
  // once the user confirms in the submission dialog, like every other contribution. Keyed by
  // project id so the staged render survives the form closing before the project is submitted.
  // Reactive so the project detail can show the staged preview before submission.
  interface StagedRender {
    file: File;
    previewUrl: string;
  }

  const stagedRenders = reactive(new Map<string, StagedRender>());

  function setStagedRender(projectId: string, render: StagedRender): void {
    if (isSubmitting.value) return;
    stagedRenders.set(projectId, render);
  }

  function getStagedRender(projectId: string): StagedRender | undefined {
    return stagedRenders.get(projectId);
  }

  function hasStagedRender(projectId: string): boolean {
    return stagedRenders.has(projectId);
  }

  function hasStagedRenders(): boolean {
    return stagedRenders.size > 0;
  }

  function clearStagedRender(projectId: string): void {
    if (isSubmitting.value) return;
    stagedRenders.delete(projectId);
  }

  // Receipt cleanup runs while editing is still locked.
  function acknowledgeStagedRender(projectId: string): void {
    stagedRenders.delete(projectId);
  }

  function clearAllState(): void {
    clearPendingSubmission();
    stagedRenders.clear();
    // The request that acquired the edit lock releases it in finally, even after sign-out.
  }

  return {
    pendingSubmission,
    showSubmissionDialog,
    isSubmitting,
    beginSubmission,
    clearPendingSubmission,
    setStagedRender,
    getStagedRender,
    hasStagedRender,
    hasStagedRenders,
    clearStagedRender,
    acknowledgeStagedRender,
    clearAllState,
  };
});

import { computed, ref } from "vue";

interface PendingSubmission {
  projectId: string;
  entityName: string | null;
  renderId?: string;
}

export const pendingSubmission = ref<PendingSubmission | null>(null);
export const showSubmissionDialog = computed(() => pendingSubmission.value !== null);
// submitDraft owns the edit lock through uploads, the write, and acknowledgement.
export const isSubmitting = ref(false);

export function resetSubmissionState(): void {
  pendingSubmission.value = null;
  // An in-flight submitDraft keeps its edit lock until its finally block runs.
}

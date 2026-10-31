import { ref } from "vue";

interface PendingSubmission {
  projectId: string;
  entityName: string | null;
  renderId?: string;
}

export const pendingSubmission = ref<PendingSubmission | null>(null);
export const showSubmissionDialog = ref(false);
// submitDraft owns the edit lock through uploads, the write, and acknowledgement.
export const isSubmitting = ref(false);

export function resetSubmissionState(): void {
  showSubmissionDialog.value = false;
  pendingSubmission.value = null;
}

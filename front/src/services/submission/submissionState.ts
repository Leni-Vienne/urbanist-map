import { ref } from "vue";

export const showSubmissionDialog = ref(false);
// submitDraft owns the edit lock through uploads, the write, and acknowledgement.
export const isSubmitting = ref(false);

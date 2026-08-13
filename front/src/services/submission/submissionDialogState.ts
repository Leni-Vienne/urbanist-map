// Standalone state module so Home.vue can import just the reactive refs
// without pulling in submissionDialog's heavy deps.
import { ref } from "vue";

export const showSubmissionDialog = ref(false);
export const isSubmitting = ref(false);

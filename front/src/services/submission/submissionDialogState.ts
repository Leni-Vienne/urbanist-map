// Standalone state module so Home.vue can import just the reactive refs
// without pulling in submissionDialog's heavy deps.
import { ref } from "vue";
import type { SubmissionSummary, SubmissionContext } from "@/services/submission/submissionTypes";

export const showSubmissionDialog = ref(false);
export const submissionSummary = ref<SubmissionSummary | null>(null);
export const pendingSubmissionContext = ref<SubmissionContext | null>(null);
export const isSubmitting = ref(false);

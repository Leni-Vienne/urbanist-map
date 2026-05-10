// Standalone state module so Home.vue can import just the reactive refs
// without pulling in useSubmissionDialog's heavy deps.
import { ref } from "vue";
import type {
  SubmissionSummary,
  SubmissionContext,
  SubmissionContextExtended,
} from "./useSubmissionService";

export const showSubmissionDialog = ref(false);
export const submissionSummary = ref<SubmissionSummary | null>(null);
export const pendingSubmissionContext = ref<SubmissionContext | SubmissionContextExtended | null>(
  null,
);
export const isSubmitting = ref(false);

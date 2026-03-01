// AI : Tiny state-only file so Home.vue can import just the reactive refs
// AI : without pulling in useSubmissionDialog's heavy deps (Zod, useSubmissionService, useChanges, projectMutations…)
// AI : All types are erased at build time — zero runtime dependency on those modules.
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

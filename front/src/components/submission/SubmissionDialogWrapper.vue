<template>
  <!-- Self-contained wrapper so Home.vue doesn't need to import useSubmissionDialog directly.
       Loaded lazily (defineAsyncComponent), only when the first submission dialog is triggered. -->
  <SubmissionConfirmationDialog
    v-if="showSubmissionDialog"
    v-model:visible="showSubmissionDialog"
    :summary="submissionSummary"
    :is-submitting="isSubmitting"
    @confirm="confirmSubmission"
    @cancel="cancelSubmission"
    @remove-change="handleRemoveChange"
  />
</template>

<script setup lang="ts">
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import SubmissionConfirmationDialog from "@/components/submission/SubmissionConfirmationDialog.vue";

const {
  showSubmissionDialog,
  submissionSummary,
  isSubmitting,
  confirmSubmission,
  cancelSubmission,
  handleRemoveChange,
} = useSubmissionDialog();
</script>

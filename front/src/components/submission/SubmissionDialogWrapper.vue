<template>
  <!-- Self-contained wrapper so Home.vue doesn't need to import submissionDialog directly.
       Loaded lazily (defineAsyncComponent), only when the first submission dialog is triggered. -->
  <SubmissionConfirmationDialog
    v-model:visible="showSubmissionDialog"
    :summary="submissionSummary"
    :is-submitting="isSubmitting"
    @confirm="confirmSubmission"
    @cancel="cancelSubmission"
    @remove-change="handleRemoveChange"
  />
</template>

<script setup lang="ts">
import { showSubmissionDialog, isSubmitting } from "@/services/submission/submissionDialogState";
import {
  submissionSummary,
  confirmSubmission,
  cancelSubmission,
  handleRemoveChange,
} from "@/services/submission/submissionDialog";
import SubmissionConfirmationDialog from "@/components/submission/SubmissionConfirmationDialog.vue";
</script>

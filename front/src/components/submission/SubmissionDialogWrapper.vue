<template>
  <!-- Self-contained wrapper so Home.vue doesn't need to import submissionWorkflow directly.
       Loaded lazily (defineAsyncComponent), only when the first submission dialog is triggered. -->
  <SubmissionConfirmationDialog
    :visible="showSubmissionDialog"
    :summary="submissionSummary"
    :is-submitting="isSubmitting"
    @confirm="confirmSubmission"
    @cancel="cancelSubmission"
    @remove-change="handleRemoveChange"
  />
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useSubmissionStore } from "@/stores/submissionStore";
import {
  useSubmissionSummary,
  confirmSubmission,
  cancelSubmission,
  handleRemoveChange,
} from "@/services/submission/submissionWorkflow";
import SubmissionConfirmationDialog from "@/components/submission/SubmissionConfirmationDialog.vue";
const { showSubmissionDialog, isSubmitting } = storeToRefs(useSubmissionStore());
const submissionSummary = useSubmissionSummary();
</script>

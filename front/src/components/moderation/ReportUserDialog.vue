<template>
  <!-- AI : Dialog for reporting a user for spam/harmful content -->
  <Dialog
    v-model:visible="dialogVisible"
    :header="$t('moderation.reportUser.report')"
    :modal="true"
    :closable="true"
    :draggable="false"
    class="report-user-dialog"
  >
    <div class="report-content">
      <p class="report-description">
        {{ $t("moderation.reportUser.reportDescription") }}
      </p>

      <div class="form-field">
        <label for="report-reason">{{ $t("moderation.reportUser.reason") }}</label>
        <Textarea
          id="report-reason"
          v-model="reason"
          :placeholder="$t('moderation.reportUser.reasonPlaceholder')"
          rows="3"
          class="reason-input"
        />
      </div>
    </div>

    <template #footer>
      <Button
        :label="$t('common.cancel')"
        severity="secondary"
        @click="handleCancel"
        :disabled="isLoading"
      />
      <Button
        :label="$t('moderation.reportUser.report')"
        severity="danger"
        @click="handleReport"
        :loading="isLoading"
        icon="pi pi-flag"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { trpc } from "@/client";

// AI : Props for the dialog
const props = defineProps<{
  visible: boolean;
  userId: string | null;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  reported: [];
}>();

const { t } = useI18n();
const toast = useToast();

// AI : Dialog visibility computed property for v-model
const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

// AI : Form state
const reason = ref("");
const isLoading = ref(false);

// AI : Handle report submission
async function handleReport() {
  if (!props.userId) return;

  isLoading.value = true;
  try {
    await trpc.moderation.reportUser.mutate({
      userId: props.userId,
      reason: reason.value || undefined,
    });

    toast.add({
      severity: "success",
      summary: t("moderation.reportUser.reportSuccess"),
      detail: t("moderation.reportUser.reportSuccessDetail"),
      life: 3000,
    });
    emit("reported");
    handleCancel();
  } catch (error) {
    console.error("Failed to report user:", error);
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: t("moderation.reportUser.reportFailed"),
      life: 3000,
    });
  } finally {
    isLoading.value = false;
  }
}

// AI : Handle cancel/close
function handleCancel() {
  reason.value = "";
  dialogVisible.value = false;
}
</script>

<style scoped>
.report-user-dialog {
  width: 400px;
  max-width: 90vw;
}

.report-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.report-description {
  margin: 0;
  color: var(--p-surface-600);
  font-size: 0.875rem;
  line-height: 1.5;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-field label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--p-surface-700);
}

.reason-input {
  width: 100%;
}
</style>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    :header="$t('moderation.reportUser.report')"
    :modal="true"
    :closable="true"
    :draggable="false"
    :style="{ width: '400px', maxWidth: '90vw' }"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-(--p-text-color-secondary) text-sm leading-relaxed">
        {{ $t("moderation.reportUser.reportDescription") }}
      </p>

      <div class="flex flex-col gap-2">
        <label for="report-reason" class="font-medium text-sm text-color">{{
          $t("moderation.reportUser.reason")
        }}</label>
        <Textarea
          id="report-reason"
          v-model="reason"
          :placeholder="$t('moderation.reportUser.reasonPlaceholder')"
          rows="3"
          class="w-full"
          dir="auto"
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
import { toastSuccess, toastError } from "@/services/core/toast";

import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";

import { trpc } from "@/client";

const props = defineProps<{
  visible: boolean;
  userId: string | null;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  reported: [];
}>();

const { t } = useI18n();

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

const reason = ref("");
const isLoading = ref(false);

async function handleReport() {
  if (!props.userId) return;

  isLoading.value = true;
  try {
    await trpc.moderation.reportUser.mutate({
      userId: props.userId,
      reason: reason.value || undefined,
    });

    toastSuccess(
      t("moderation.reportUser.reportSuccessDetail"),
      t("moderation.reportUser.reportSuccess"),
    );
    emit("reported");
    handleCancel();
  } catch (error) {
    console.error("Failed to report user:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("moderation.reportUser.reportFailed"),
    );
  } finally {
    isLoading.value = false;
  }
}

function handleCancel() {
  reason.value = "";
  dialogVisible.value = false;
}
</script>

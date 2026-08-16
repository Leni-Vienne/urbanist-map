<template>
  <Dialog
    v-model:visible="dialogVisible"
    :header="$t('moderation.reportUser.report')"
    :modal="true"
    :closable="!isLoading"
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
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    isLoading?: boolean;
  }>(),
  { isLoading: false },
);

const emit = defineEmits<{
  "update:visible": [value: boolean];
  report: [reason: string];
}>();

const reason = ref("");

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

watch(
  () => props.visible,
  (visible) => {
    if (visible) reason.value = "";
  },
);

function handleReport() {
  if (props.isLoading) return;
  emit("report", reason.value);
}

function handleCancel() {
  reason.value = "";
  dialogVisible.value = false;
}
</script>

<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.confirmRejection')"
    :style="{ width: '450px' }"
    @update:visible="handleVisibilityChange"
  >
    <!-- Confirmation message -->
    <p class="mb-4 text-color">
      {{ $t("moderation.confirmRejectionMessage") }}
    </p>

    <!-- Rejection reason dropdown -->
    <div class="flex flex-col gap-2 mb-4">
      <label for="rejection-reason-select" class="text-sm font-medium text-color">
        {{ $t("moderation.rejectionReason.label") }}
      </label>
      <Select
        inputId="rejection-reason-select"
        v-model="rejectionReason"
        :options="rejectionReasons"
        option-label="label"
        option-value="value"
        :placeholder="$t('moderation.rejectionReason.placeholder')"
        class="w-full"
      />
    </div>

    <!-- Reject all pending overlays checkbox (only for projects) -->
    <div
      v-if="pendingOverlayCount > 0"
      class="flex flex-col gap-2 mb-4 p-3 bg-content-hover-background rounded-md border border-surface"
    >
      <div class="flex items-center gap-2">
        <Checkbox v-model="rejectAllOverlays" input-id="reject-overlays" :binary="true" />
        <label for="reject-overlays" class="cursor-pointer font-medium text-color">
          {{
            $t("moderation.rejectAllOverlays", {
              count: pendingOverlayCount,
            })
          }}
        </label>
      </div>
    </div>

    <!-- Report user checkbox (only show if userId is provided) -->
    <div
      v-if="userId"
      class="flex flex-col gap-3 p-4 bg-content-hover-background rounded-md border border-surface"
    >
      <div class="flex items-center gap-2">
        <Checkbox v-model="reportUser" input-id="report-user" :binary="true" />
        <label for="report-user" class="cursor-pointer font-medium text-color">
          {{ $t("moderation.reportUser.report") }}
        </label>
      </div>

      <!-- Report reason field (only visible when checkbox is checked) -->
      <div v-if="reportUser" class="flex flex-col gap-2">
        <label for="report-reason" class="text-sm font-medium text-color">
          {{ $t("moderation.reportUser.reason") }}
        </label>
        <Textarea
          id="report-reason"
          v-model="reportReason"
          :placeholder="$t('moderation.reportUser.reasonPlaceholder')"
          rows="3"
          auto-resize
          class="w-full"
          dir="auto"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <Button :label="$t('common.cancel')" severity="secondary" @click="handleCancel" />
        <Button
          :label="$t('moderation.reject')"
          severity="danger"
          icon="pi pi-times"
          :loading="isLoading"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";

interface Props {
  visible: boolean;
  userId?: string | null;
  isLoading?: boolean;
  pendingOverlayCount?: number; // Number of pending overlays for this project (0 for overlays)
}

const props = withDefaults(defineProps<Props>(), {
  userId: null,
  isLoading: false,
  pendingOverlayCount: 0,
});

const { t } = useI18n();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  confirm: [
    options: {
      rejectionReason: string;
      rejectAllOverlays: boolean;
      reportUser: boolean;
      reportReason: string;
    },
  ];
  cancel: [];
}>();

const rejectionReasons = computed(() => [
  {
    label: t("moderation.rejectionReason.low_quality"),
    value: "low_quality",
  },
  {
    label: t("moderation.rejectionReason.incorrect_location"),
    value: "incorrect_location",
  },
  { label: t("moderation.rejectionReason.duplicate"), value: "duplicate" },
  {
    label: t("moderation.rejectionReason.insufficient_info"),
    value: "insufficient_info",
  },
  {
    label: t("moderation.rejectionReason.not_construction"),
    value: "not_construction",
  },
  { label: t("moderation.rejectionReason.spam"), value: "spam" },
]);

const isVisible = ref(props.visible);
const rejectionReason = ref("");
const rejectAllOverlays = ref(false);
const reportUser = ref(false);
const reportReason = ref("");

watch(
  () => props.visible,
  (newValue) => {
    isVisible.value = newValue;
    if (newValue) {
      rejectionReason.value = "";
      rejectAllOverlays.value = false;
      reportUser.value = false;
      reportReason.value = "";
    }
  },
);

function handleVisibilityChange(value: boolean) {
  emit("update:visible", value);
  if (!value) {
    emit("cancel");
  }
}

function handleCancel() {
  emit("update:visible", false);
  emit("cancel");
}

function handleConfirm() {
  emit("confirm", {
    rejectionReason: rejectionReason.value,
    rejectAllOverlays: rejectAllOverlays.value,
    reportUser: reportUser.value,
    reportReason: reportReason.value,
  });
}
</script>

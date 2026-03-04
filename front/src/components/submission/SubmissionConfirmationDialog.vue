<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('submission.confirmTitle')"
    :style="{ width: '600px' }"
    @update:visible="handleVisibilityChange"
  >
    <div v-if="summary" class="flex flex-col gap-4 py-2">
      <!-- Entity Information -->
      <div class="flex items-center justify-between p-3 bg-content-hover-background rounded-md">
        <strong>{{ summary.entityName }}</strong>
        <Tag
          :severity="summary.requiresModeration ? 'warn' : 'success'"
          :value="
            summary.requiresModeration
              ? $t('submission.requiresModeration')
              : $t('submission.immediateUpdate')
          "
        />
      </div>

      <!-- Changes List -->
      <div v-if="summary.changes.length > 0" class="flex flex-col gap-3">
        <div class="flex flex-col gap-3">
          <div
            v-for="(change, index) in summary.changes"
            :key="index"
            class="flex flex-col gap-2 p-3 bg-content-background border border-surface rounded"
          >
            <!-- Header row with thumbnail (for overlays), label, and delete button -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <img
                  v-if="change.thumbnailUrl"
                  :src="change.thumbnailUrl"
                  :alt="change.displayLabel"
                  class="w-12 h-12 object-cover rounded border border-surface shrink-0"
                  @error="handleImageError"
                />
                <div class="font-medium text-sm text-(--p-text-color-secondary)">
                  {{ change.displayLabel }}
                </div>
              </div>
              <!-- Delete button for all changes -->
              <Button
                icon="pi pi-times"
                severity="danger"
                text
                rounded
                class="shrink-0"
                @click="handleRemoveChange(index, change.field, change.overlayId)"
                v-tooltip.top="$t('submission.removeChange')"
              />
            </div>

            <div class="flex items-center gap-3">
              <span
                class="flex-1 p-2 rounded text-sm wrap-break-word bg-content-hover-background text-(--p-text-color-secondary) line-through"
                >{{ change.oldValue }}</span
              >
              <i class="pi pi-arrow-right text-muted-color text-sm shrink-0"></i>
              <span
                class="flex-1 p-2 rounded text-sm wrap-break-word bg-[color-mix(in_srgb,var(--p-primary-color)_10%,transparent)] text-color font-medium"
                >{{ change.newValue }}</span
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Reason for changes input (optional) -->
      <div v-if="summary?.requiresModeration" class="flex flex-col gap-2">
        <label for="changeReason" class="font-medium text-sm text-(--p-text-color-secondary)">
          {{ $t("common.reasonForChanges") }}
          <span class="font-normal italic">({{ $t("project.optionalField") }})</span></label
        >
        <Textarea
          id="changeReason"
          v-model="changeReason"
          rows="2"
          :placeholder="$t('common.explainChanges')"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <Button :label="$t('common.cancel')" severity="secondary" @click="handleCancel" />
        <Button
          :label="$t('submission.confirmSubmit')"
          :severity="summary?.requiresModeration ? 'warn' : 'success'"
          :loading="isSubmitting"
          :disabled="summary?.changes.length === 0 && summary?.changeType !== 'create'"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SubmissionSummary } from "@/composables/submission/useSubmissionService";
import type { RemovableChange } from "@/types/index";
import { handleImageError } from "@/utils/imageErrorHandler";

const { t: $t } = useI18n();

// Change reason input
const changeReason = ref("");

// Props
interface Props {
  visible: boolean;
  summary: SubmissionSummary | null;
  isSubmitting?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isSubmitting: false,
});

// Emits
const emit = defineEmits<{
  "update:visible": [value: boolean];
  confirm: [reason: string];
  cancel: [];
  "remove-change": [index: number, field: RemovableChange, overlayId?: string];
}>();

// Local visibility state
const isVisible = ref(props.visible);

// Watch for external visibility changes
watch(
  () => props.visible,
  (newValue) => {
    isVisible.value = newValue;
  },
);

// Handle visibility change from dialog
function handleVisibilityChange(value: boolean) {
  emit("update:visible", value);
}

// Handle cancel button
function handleCancel() {
  changeReason.value = "";
  emit("cancel");
  emit("update:visible", false);
}

// Handle confirm button
function handleConfirm() {
  emit("confirm", changeReason.value);
  changeReason.value = "";
}

// Handle remove change button click
function handleRemoveChange(index: number, field: RemovableChange, overlayId?: string) {
  emit("remove-change", index, field, overlayId);
}
</script>

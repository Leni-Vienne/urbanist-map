<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :closable="!isSubmitting"
    :close-on-escape="!isSubmitting"
    :header="$t('submission.confirmTitle')"
    :style="{ width: '540px' }"
  >
    <div v-if="summary" class="flex flex-col gap-5 py-1">
      <!-- Entity name + moderation status pill -->
      <div class="flex items-center justify-between gap-3">
        <span class="text-base font-semibold text-color truncate">{{ summary.entityName }}</span>
        <Tag
          class="shrink-0"
          :severity="summary.requiresModeration ? 'warn' : 'success'"
          :icon="summary.requiresModeration ? 'pi pi-shield' : 'pi pi-check'"
          :value="
            summary.requiresModeration
              ? $t('submission.requiresModeration')
              : $t('submission.immediateUpdate')
          "
        />
      </div>

      <!-- Changes -->
      <section v-if="summary.changes.length > 0" class="flex flex-col gap-2">
        <div
          class="flex items-center text-[11px] font-semibold uppercase tracking-wide text-muted-color"
        >
          <span>{{ $t("submission.changesLabel") }}</span>
        </div>

        <div class="overflow-hidden rounded-lg border border-surface">
          <div
            v-for="(change, index) in summary.changes"
            :key="index"
            class="flex items-center gap-3 pl-2"
            :class="index > 0 ? 'border-t border-surface' : ''"
          >
            <img
              v-if="change.thumbnailUrl"
              :src="change.thumbnailUrl"
              :alt="change.displayLabel"
              class="w-9 h-9 object-cover rounded border border-surface shrink-0"
              @error="handleImageError"
            />

            <span class="w-24 shrink-0 text-xs font-semibold text-(--p-text-color-secondary)">
              {{ change.displayLabel }}
            </span>
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <span
                class="min-w-0 truncate rounded-md border px-2 py-0.5 text-[13px]"
                :class="
                  change.oldValue
                    ? 'border-rose-200 bg-rose-50 text-rose-700 line-through dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'border-surface bg-(--p-content-hover-background) text-muted-color italic'
                "
                >{{ change.oldValue || $t("common.noValue") }}</span
              >
              <i class="pi pi-arrow-right text-muted-color text-xs shrink-0"></i>
              <span
                class="min-w-0 flex-1 truncate rounded-md border px-2 py-0.5 text-[13px] font-medium text-color border-[color-mix(in_srgb,var(--p-primary-color)_35%,transparent)] bg-[color-mix(in_srgb,var(--p-primary-color)_12%,transparent)]"
                >{{ change.newValue || $t("common.noValue") }}</span
              >
            </div>

            <Button
              icon="pi pi-trash"
              severity="secondary"
              text
              rounded
              class="shrink-0"
              :disabled="isSubmitting"
              @click="handleRemoveChange(change.field, change.overlayId)"
              v-tooltip.top="$t('submission.removeChange')"
            />
          </div>
        </div>
      </section>

      <!-- Reason for changes input (optional) -->
      <section v-if="summary?.requiresModeration" class="flex flex-col gap-2">
        <label
          for="changeReason"
          class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-color"
        >
          <span>{{ $t("common.reasonForChanges") }}</span>
          <span class="font-medium normal-case tracking-normal">{{
            $t("project.optionalField")
          }}</span>
        </label>
        <Textarea
          id="changeReason"
          v-model="changeReason"
          rows="2"
          :placeholder="$t('common.explainChanges')"
          dir="auto"
        />
      </section>

      <div
        class="flex items-start gap-2 p-2.5 rounded-md text-xs leading-relaxed bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
      >
        <i class="pi pi-info-circle mt-0.5 shrink-0"></i>
        <span>{{ $t("common.osmSyncNotice") }}</span>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <Button
          :label="$t('common.cancel')"
          severity="secondary"
          :disabled="isSubmitting"
          @click="handleCancel"
        />
        <Button
          :label="$t('submission.confirmSubmit')"
          icon="pi pi-send"
          :loading="isSubmitting"
          :disabled="summary?.changes.length === 0 && summary?.changeType !== 'create'"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { RemovableChange, SubmissionSummary } from "@/services/submission/submissionTypes";
import { handleImageError } from "@/utils/imageErrorHandler";

const { t: $t } = useI18n();

const changeReason = ref("");

interface Props {
  visible: boolean;
  summary: SubmissionSummary | null;
  isSubmitting?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isSubmitting: false,
});

const emit = defineEmits<{
  "update:visible": [value: boolean];
  confirm: [reason: string];
  cancel: [];
  "remove-change": [field: RemovableChange, overlayId?: string];
}>();

const isVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => {
    if (!value) {
      requestClose();
      return;
    }
    emit("update:visible", value);
  },
});

function requestClose() {
  changeReason.value = "";
  emit("cancel");
}

function handleCancel() {
  requestClose();
}

function handleConfirm() {
  emit("confirm", changeReason.value);
  changeReason.value = "";
}

function handleRemoveChange(field: RemovableChange, overlayId?: string) {
  emit("remove-change", field, overlayId);
}
</script>

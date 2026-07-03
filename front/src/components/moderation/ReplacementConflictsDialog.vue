<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.replacementConflicts.title')"
    :style="{ width: '700px', maxHeight: '80vh' }"
    @update:visible="handleVisibilityChange"
  >
    <div v-if="conflicts" class="flex flex-col gap-6">
      <!-- Image Comparison -->
      <div
        v-if="conflicts.originalOverlayFilename && conflicts.newOverlayFilename"
        class="flex items-center justify-center gap-8 p-6 bg-content-hover-background rounded-lg border border-surface"
      >
        <div class="flex flex-col items-center gap-2 flex-1 max-w-62">
          <div class="text-sm font-semibold text-color uppercase tracking-wider">
            {{ $t("common.current") }}
          </div>
          <img
            :src="buildImageUrl(conflicts.originalOverlayFilename, false)"
            :alt="conflicts.originalOverlayCaption || 'Original overlay'"
            class="w-full h-auto max-h-50 object-contain rounded-lg border-2 border-surface bg-content-background"
          />
          <div class="text-sm text-(--p-text-color-secondary) text-center font-medium">
            {{ conflicts.originalOverlayCaption || $t("overlay.untitled") }}
          </div>
        </div>
        <div class="text-4xl text-primary-500 shrink-0">
          <i class="pi pi-arrow-right"></i>
        </div>
        <div class="flex flex-col items-center gap-2 flex-1 max-w-62">
          <div class="text-sm font-semibold text-color uppercase tracking-wider">
            {{ $t("common.new") }}
          </div>
          <img
            :src="buildImageUrl(conflicts.newOverlayFilename, true)"
            :alt="conflicts.newOverlayCaption || 'New overlay'"
            class="w-full h-auto max-h-50 object-contain rounded-lg border-2 border-surface bg-content-background"
          />
          <div class="text-sm text-(--p-text-color-secondary) text-center font-medium">
            {{ conflicts.newOverlayCaption || $t("overlay.untitled") }}
          </div>
        </div>
      </div>

      <!-- Pending Change Requests -->
      <div v-if="conflicts.pendingChangeRequests.length > 0" class="flex flex-col gap-3">
        <div class="flex items-center gap-2 text-base font-semibold text-color">
          <i class="pi pi-exclamation-triangle text-orange-600"></i>
          <span>{{
            $t("moderation.replacementConflicts.pendingChanges", {
              count: conflicts.pendingChangeRequests.length,
            })
          }}</span>
        </div>
        <div class="max-h-62 overflow-y-auto flex flex-col gap-3 pr-2">
          <div
            v-for="change in conflicts.pendingChangeRequests"
            :key="change.id"
            class="p-4 bg-content-hover-background border border-surface rounded-lg"
          >
            <div class="flex justify-between items-center mb-2">
              <strong>{{ $t(`fields.${change.fieldName}`) }}</strong>
              <Tag severity="warning" :value="$t('approvalStatus.pending')" />
            </div>
            <div class="flex items-center gap-3 mt-2 p-2 bg-content-background rounded-md">
              <span class="px-2 py-1 bg-content-hover-background rounded text-sm font-mono">{{
                formatValue(change.oldValue)
              }}</span>
              <i class="pi pi-arrow-right"></i>
              <span class="px-2 py-1 bg-content-hover-background rounded text-sm font-mono">{{
                formatValue(change.newValue)
              }}</span>
            </div>
            <div
              v-if="change.changeReason"
              class="mt-2 p-2 text-sm text-color bg-content-hover-background rounded italic"
            >
              {{ change.changeReason }}
            </div>
          </div>
        </div>
        <p
          class="m-0 p-3 bg-red-50 text-red-900 rounded-md text-sm font-medium dark:bg-red-900/30 dark:text-red-300"
        >
          {{ $t("moderation.replacementConflicts.changesWillBeConflicted") }}
        </p>
      </div>

      <!-- Competing Replacements -->
      <div v-if="conflicts.competingReplacements.length > 0" class="flex flex-col gap-3">
        <div class="flex items-center gap-2 text-base font-semibold text-color">
          <i class="pi pi-clone text-orange-600"></i>
          <span>{{
            $t("moderation.replacementConflicts.competingReplacements", {
              count: conflicts.competingReplacements.length,
            })
          }}</span>
        </div>
        <div class="max-h-62 overflow-y-auto flex flex-col gap-3 pr-2">
          <div
            v-for="competing in conflicts.competingReplacements"
            :key="competing.id"
            class="p-4 bg-content-hover-background border border-surface rounded-lg"
          >
            <div class="flex gap-4 items-center">
              <img
                :src="buildThumbnailUrl(competing.filename, true)"
                :alt="competing.caption || 'Competing overlay'"
                class="w-20 h-20 object-cover rounded-md border-2 border-surface shrink-0"
              />
              <div class="flex-1 min-w-0">
                <div class="flex justify-between items-center mb-2">
                  <strong>{{ competing.caption || $t("overlay.untitled") }}</strong>
                  <span class="text-sm text-(--p-text-color-secondary)">{{
                    formatDate(competing.createdAt) || "—"
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p
          class="m-0 p-3 bg-red-50 text-red-900 rounded-md text-sm font-medium dark:bg-red-900/30 dark:text-red-300"
        >
          {{ $t("moderation.replacementConflicts.competingWillBeRejected") }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <Button
          :label="$t('common.cancel')"
          severity="secondary"
          :disabled="isLoading"
          @click="handleCancel"
        />
        <Button
          :label="$t('moderation.replacementConflicts.approveAndResolve')"
          severity="danger"
          :loading="isLoading"
          icon="pi pi-check"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { buildImageUrl, buildThumbnailUrl } from "@/utils/imageUrl";
import { useI18n } from "vue-i18n";
import { formatDate } from "@/utils/dateFormat";

const { t: $t } = useI18n();

export interface ReplacementConflicts {
  isReplacement: boolean;
  originalOverlayCaption: string | null;
  originalOverlayFilename: string;
  newOverlayFilename: string;
  newOverlayCaption: string | null;
  pendingChangeRequests: {
    id: string;
    fieldName: string;
    oldValue: any;
    newValue: any;
    changeReason: string | null;
    requestedBy: string | null;
    createdAt: Date;
  }[];
  competingReplacements: {
    id: string;
    filename: string;
    caption: string | null;
    authorId: string | null;
    createdAt: Date;
  }[];
  hasConflicts: boolean;
}

interface Props {
  visible: boolean;
  conflicts: ReplacementConflicts | null;
  isLoading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false,
});

const emit = defineEmits<{
  "update:visible": [value: boolean];
  confirm: [];
  cancel: [];
}>();

const isVisible = ref(props.visible);

watch(
  () => props.visible,
  (newValue) => {
    isVisible.value = newValue;
  },
);

function handleVisibilityChange(value: boolean) {
  emit("update:visible", value);
}

function handleCancel() {
  emit("cancel");
  isVisible.value = false;
}

function handleConfirm() {
  emit("confirm");
}

function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return $t("common.unknown");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
</script>

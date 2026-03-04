<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.moderatedContributions.title')"
    :style="{ width: '90vw', maxWidth: '600px' }"
    :closable="true"
    @hide="emit('close')"
  >
    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center items-center py-8">
      <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" />
    </div>

    <!-- Empty state -->
    <div v-else-if="moderatedContributions.length === 0" class="text-center py-8">
      <i class="pi pi-check-circle text-6xl text-green-500 mb-4"></i>
      <p class="text-lg">
        {{ $t("moderation.moderatedContributions.noItems") }}
      </p>
    </div>

    <!-- List of moderated contributions -->
    <div v-else class="space-y-4">
      <p class="text-sm text-(--p-text-color-secondary) mb-4">
        {{ $t("moderation.moderatedContributions.description") }}
      </p>

      <div v-for="item in moderatedContributions" :key="item.id" class="flex gap-4">
        <!-- Thumbnail -->
        <div
          class="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-content-hover-background flex items-center justify-center"
        >
          <!-- Overlay thumbnail -->
          <img
            v-if="item.type === 'overlay' && item.filename"
            :src="buildThumbnailUrl(item.filename, item.status === 'pending')"
            :alt="item.caption || 'Overlay'"
            class="w-full h-full object-cover"
            @error="handleImageError"
          />
          <!-- Standalone project icon -->
          <i
            v-else-if="item.type === 'standalone'"
            class="pi pi-building text-3xl text-primary-color"
          ></i>
        </div>

        <!-- Content -->
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span
              class="font-semibold text-[0.9375rem] overflow-hidden text-ellipsis whitespace-nowrap"
              >{{ item.caption || item.projectName || $t("overlay.untitled") }}</span
            >
            <Tag
              :value="$t(`status.${item.status}`)"
              :severity="
                item.status === 'rejected'
                  ? 'danger'
                  : item.status === 'approved'
                    ? 'success'
                    : 'secondary'
              "
              rounded
            />
          </div>

          <!-- Show location for all items -->
          <p
            v-if="item.cityName"
            class="flex items-center gap-1 text-xs text-(--p-text-color-secondary) m-0"
          >
            <i class="pi pi-map-marker text-muted-color" style="font-size: 0.625rem"></i>
            {{ item.cityName }}{{ item.countryCode ? `, ${item.countryCode}` : "" }}
          </p>

          <!-- Display rejection reason if item was rejected -->
          <p
            v-if="item.status === 'rejected' && item.rejectionReason"
            class="m-0 text-[0.8125rem] text-red-600 bg-red-50 p-2 rounded-md border border-red-200 flex items-start gap-1.5 leading-snug"
          >
            <i class="pi pi-ban shrink-0 mt-0.5"></i>
            <span
              ><strong>{{ $t("moderation.rejectionReason.label") }}:</strong>
              {{ $t(`moderation.rejectionReason.${item.rejectionReason}`) }}</span
            >
          </p>

          <p class="m-0 text-xs text-muted-color">
            {{ formatRelativeTime(item.updatedAt, t) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Footer actions -->
    <template #footer>
      <Button
        :label="$t('common.close')"
        severity="secondary"
        outlined
        @click="isVisible = false"
      />
      <Button
        v-if="moderatedContributions.length > 0"
        :label="$t('moderation.moderatedContributions.acknowledgeAll')"
        :loading="isAcknowledging"
        @click="handleAcknowledgeAll"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";

import ProgressSpinner from "primevue/progressspinner";
import { useModeratedContributions } from "@/composables/moderation/useModeratedContributions";
import { useToast } from "@/composables/ui/useToast";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { formatRelativeTime } from "@/utils/dateFormat";
import { useI18n } from "vue-i18n";
import { handleImageError } from "@/utils/imageErrorHandler";

interface Props {
  visible: boolean;
}

interface Emits {
  (e: "update:visible", value: boolean): void;
  (e: "close"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useI18n();
const toast = useToast();

const { moderatedContributions, isLoading, fetchModeratedContributions, acknowledgeAll } =
  useModeratedContributions();

const isVisible = ref(props.visible);
const isAcknowledging = ref(false);

// Fetch on mount — dialog is always mounted with visible=true due to v-if in parent
onMounted(() => {
  fetchModeratedContributions();
});

// Sync visibility with prop (re-fetch if dialog is shown again without unmounting)
watch(
  () => props.visible,
  (newVal) => {
    isVisible.value = newVal;
    if (newVal) {
      fetchModeratedContributions();
    }
  },
);

// Update parent when visibility changes
watch(isVisible, (newVal) => {
  emit("update:visible", newVal);
  if (!newVal) {
    emit("close");
  }
});

// Handle acknowledge all button
async function handleAcknowledgeAll() {
  isAcknowledging.value = true;
  try {
    const result = await acknowledgeAll();
    if (result.success) {
      toast.add({
        severity: "success",
        summary: t("moderation.moderatedContributions.acknowledgeSuccess"),
        detail: t("moderation.moderatedContributions.acknowledgeSuccessDetail"),
        life: 3000,
      });
      emit("close");
    }
  } finally {
    isAcknowledging.value = false;
  }
}
</script>

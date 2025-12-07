<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.moderatedContributions.title')"
    :style="{ width: '90vw', maxWidth: '600px' }"
    :closable="true"
    @hide="emit('close')"
  >
    <!-- AI : Loading state -->
    <div v-if="isLoading" class="flex justify-center items-center py-8">
      <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" />
    </div>

    <!-- AI : Empty state -->
    <div v-else-if="moderatedContributions.length === 0" class="text-center py-8">
      <i class="pi pi-check-circle text-6xl text-green-500 mb-4"></i>
      <p class="text-lg">{{ $t('moderation.moderatedContributions.noItems') }}</p>
    </div>

    <!-- AI : List of moderated contributions -->
    <div v-else class="space-y-4">
      <p class="text-sm text-surface-600 mb-4">
        {{ $t('moderation.moderatedContributions.description') }}
      </p>

      <div
        v-for="item in moderatedContributions"
        :key="item.id"
        class="moderated-item"
      >
        <!-- AI : Thumbnail -->
        <div class="thumbnail-container">
          <img
            :src="buildThumbnailUrl(item.filename, true)"
            :alt="item.caption || 'Overlay'"
            class="thumbnail"
            @error="handleImageError"
          />
        </div>

        <!-- AI : Content -->
        <div class="item-content">
          <div class="item-header">
            <span class="item-title">{{ item.caption || $t('overlay.untitled') }}</span>
            <Tag
              :value="$t(`status.${item.status}`)"
              :severity="item.status === 'rejected' ? 'danger' : 'secondary'"
              rounded
            />
          </div>

          <p class="item-project">{{ item.projectName || $t('overlay.unknownLocation') }}</p>

          <p v-if="item.status === 'replaced' && item.replacedByOverlayId" class="item-info">
            <i class="pi pi-info-circle"></i>
            {{ $t('moderation.moderatedContributions.replacedInfo') }}
          </p>

          <p class="item-date">
            {{ formatRelativeTime(item.updatedAt, t) }}
          </p>
        </div>
      </div>
    </div>

    <!-- AI : Footer actions -->
    <template #footer>
      <Button
        :label="$t('common.close')"
        severity="secondary"
        outlined
        @click="emit('close')"
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
import { ref, watch } from 'vue'

import ProgressSpinner from 'primevue/progressspinner'
import { useModeratedContributions } from '@/composables/moderation/useModeratedContributions'
import { useToast } from '@/composables/ui/useToast'
import { buildThumbnailUrl } from '@/utils/imageUrl'
import { formatRelativeTime } from '@/utils/dateFormat'
import { useI18n } from 'vue-i18n'

interface Props {
  visible: boolean
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()
const toast = useToast()

const {
  moderatedContributions,
  isLoading,
  fetchModeratedContributions,
  acknowledgeAll
} = useModeratedContributions()

const isVisible = ref(props.visible)
const isAcknowledging = ref(false)
const imageBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

// AI : Sync visibility with prop
watch(() => props.visible, (newVal) => {
  isVisible.value = newVal
  if (newVal) {
    fetchModeratedContributions()
  }
})

// AI : Update parent when visibility changes
watch(isVisible, (newVal) => {
  emit('update:visible', newVal)
  if (!newVal) {
    emit('close')
  }
})

// AI : Handle acknowledge all button
async function handleAcknowledgeAll() {
  isAcknowledging.value = true
  try {
    const result = await acknowledgeAll()
    if (result.success) {
      toast.add({
        severity: 'success',
        summary: t('moderation.moderatedContributions.acknowledgeSuccess'),
        detail: t('moderation.moderatedContributions.acknowledgeSuccessDetail'),
        life: 3000
      })
      emit('close')
    }
  } finally {
    isAcknowledging.value = false
  }
}

// AI : Handle image load error
function handleImageError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}
</script>

<style scoped>
.moderated-item {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius);
  background: var(--p-surface-ground);
}

.thumbnail-container {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  border-radius: var(--p-border-radius);
  overflow: hidden;
  background: var(--p-surface-100);
}

.thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.item-title {
  font-weight: 600;
  font-size: 0.9375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-project {
  font-size: 0.875rem;
  color: var(--p-surface-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-info {
  font-size: 0.8125rem;
  color: var(--p-primary-500);
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.item-date {
  font-size: 0.75rem;
  color: var(--p-surface-500);
}
</style>

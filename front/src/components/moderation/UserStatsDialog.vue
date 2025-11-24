<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.userStats.submitterStats')"
    :style="{ width: '450px' }"
    @update:visible="handleClose"
  >
    <div class="user-stats-content">
      <div class="submitter-header">
        <i class="pi pi-user submitter-icon"></i>
        <div class="submitter-info">
          <div class="submitter-label">{{ $t('moderation.userStats.submittedBy') }}</div>
          <div class="submitter-name">{{ username || $t('moderation.unknownUser') }}</div>
        </div>
      </div>

      <div class="stats-divider"></div>

      <div class="stat-row">
        <span class="stat-label">{{ $t('moderation.userStats.approved') }}:</span>
        <span class="stat-value stat-approved">{{ approvedCount }}</span>
      </div>

      <div class="stat-row">
        <span class="stat-label">{{ $t('moderation.userStats.rejected') }}:</span>
        <span class="stat-value stat-rejected">{{ rejectedCount }}</span>
      </div>

      <div v-if="reportCount > 0" class="stat-row report-row">
        <span class="stat-label">
          <i class="pi pi-exclamation-triangle"></i>
          {{ $t('moderation.userStats.reports') }}:
        </span>
        <span class="stat-value stat-warning">{{ reportCount }}</span>
      </div>

      <div v-if="hasHighRejectionRate" class="warning-message">
        <i class="pi pi-exclamation-triangle"></i>
        {{ $t('moderation.userStats.highRejectionRate') }}
      </div>
    </div>

    <template #footer>
      <Button
        :label="$t('moderation.reportUser.report')"
        icon="pi pi-flag"
        severity="warning"
        @click="handleReport"
      />
      <Button
        :label="$t('common.close')"
        severity="secondary"
        @click="handleClose"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  visible: boolean
  userId?: string | null
  username?: string | null
  approvedCount?: number | null
  rejectedCount?: number | null
  reportCount?: number
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  userId: null,
  username: null,
  approvedCount: 0,
  rejectedCount: 0,
  reportCount: 0
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'report': [userId: string]
}>()

const { t } = useI18n()

const isVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const hasHighRejectionRate = computed(() => {
  const approved = props.approvedCount ?? 0
  const rejected = props.rejectedCount ?? 0
  const total = approved + rejected
  if (total < 3) return false
  return rejected >= 3 && (approved / total) < 0.3
})

function handleClose() {
  emit('update:visible', false)
}

function handleReport() {
  if (props.userId) {
    emit('report', props.userId)
    handleClose()
  }
}
</script>

<style scoped>
.user-stats-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem 0;
}

.submitter-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: linear-gradient(135deg, var(--p-primary-50) 0%, var(--p-primary-100) 100%);
  border-radius: 8px;
  border: 2px solid var(--p-primary-200);
}

.submitter-icon {
  font-size: 2rem;
  color: var(--p-primary-600);
  background: white;
  padding: 0.75rem;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.submitter-info {
  flex: 1;
}

.submitter-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-primary-700);
  letter-spacing: 0.5px;
  margin-bottom: 0.25rem;
}

.submitter-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--p-primary-900);
}

.stats-divider {
  height: 1px;
  background: var(--p-surface-200);
  margin: 0.5rem 0;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: var(--p-surface-50);
  border-radius: 4px;
}

.stat-row.report-row {
  background: var(--p-orange-50);
  border: 1px solid var(--p-orange-200);
}

.stat-label {
  font-weight: 600;
  color: var(--p-surface-700);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.stat-value {
  font-weight: 700;
  font-size: 1.125rem;
}

.stat-approved {
  color: var(--p-green-600);
}

.stat-rejected {
  color: var(--p-red-600);
}

.stat-warning {
  color: var(--p-orange-600);
}

.warning-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-red-50);
  border: 1px solid var(--p-red-200);
  border-radius: 4px;
  color: var(--p-red-700);
  font-weight: 600;
  font-size: 0.875rem;
}

.warning-message i {
  color: var(--p-red-600);
}
</style>

<template>
  <span v-if="username || userId" class="user-badge-inline" :class="{ 'has-warning': hasWarning, 'has-reports': hasReports, 'clickable': clickable }" @click="handleClick">
    <i v-if="hasReports" class="pi pi-exclamation-triangle report-icon"></i>
    <span class="username-link">{{ displayName }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// AI : Props interface
interface Props {
  userId?: string | null
  username?: string | null
  approvedCount?: number | null
  rejectedCount?: number | null
  reportCount?: number
  clickable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  userId: null,
  username: null,
  approvedCount: 0,
  rejectedCount: 0,
  reportCount: 0,
  clickable: false
})

const emit = defineEmits<{
  click: [userId: string]
}>()

// AI : Use i18n for translations
const { t } = useI18n()

// AI : Computed: Display name (username or fallback to shortened UUID)
const displayName = computed(() => {
  if (props.username) return props.username
  if (props.userId) {
    // AI : Fallback to shortened UUID if no username
    return `${props.userId.substring(0, 8)}...`
  }
  return t('moderation.unknownUser')
})

// AI : Computed: Check if user has high rejection rate
const hasWarning = computed(() => {
  const approved = props.approvedCount ?? 0
  const rejected = props.rejectedCount ?? 0
  const total = approved + rejected
  if (total < 3) return false
  return rejected >= 3 && (approved / total) < 0.3
})

// AI : Computed: Check if user has reports
const hasReports = computed(() => {
  return (props.reportCount ?? 0) > 0
})

// AI : Handle click event
function handleClick() {
  if (props.clickable && props.userId) {
    emit('click', props.userId)
  }
}
</script>

<style scoped>
.user-badge-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--p-surface-600);
  white-space: nowrap;
}

.user-badge-inline.clickable {
  cursor: pointer;
}

.username-link {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  transition: color 0.15s ease;
}

.user-badge-inline.clickable:hover .username-link {
  color: var(--p-primary-600);
  text-decoration-style: solid;
}

.user-badge-inline.has-warning .username-link {
  color: var(--p-red-600);
  font-weight: 600;
}

.user-badge-inline.has-warning:hover .username-link {
  color: var(--p-red-700);
}

.report-icon {
  font-size: 0.625rem;
  color: var(--p-orange-600);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>

<template>
  <div class="moderation-action-buttons">
    <!-- AI : Approve button -->
    <button
      class="action-btn approve-btn"
      :class="{ 'disabled-btn': finalApproveDisabled }"
      :disabled="finalApproveDisabled"
      @click="$emit('approve')"
      v-tooltip.top="finalApproveDisabled && disabledTooltip ? disabledTooltip : $t('moderation.approveChange')"
    >
      <i class="pi pi-check"></i>
    </button>

    <!-- AI : Simple reject button (no dropdown) -->
    <button
      class="action-btn reject-btn"
      :class="{ 'disabled-btn': finalRejectDisabled }"
      :disabled="finalRejectDisabled"
      @click="$emit('reject')"
      v-tooltip.top="finalRejectDisabled && disabledTooltip ? disabledTooltip : $t('moderation.rejectChange')"
    >
      <i class="pi pi-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// AI : Props for the moderation action buttons
interface Props {
  disabled?: boolean
  disabledTooltip?: string
  approveDisabled?: boolean
  rejectDisabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  disabledTooltip: '',
  approveDisabled: false,
  rejectDisabled: false
})

// AI : Events emitted by the component
defineEmits<{
  approve: []
  reject: []
}>()

// AI : Computed: Final disabled state for approve button
const finalApproveDisabled = computed(() => props.disabled || props.approveDisabled)

// AI : Computed: Final disabled state for reject button
const finalRejectDisabled = computed(() => props.disabled || props.rejectDisabled)
</script>

<style scoped>
.moderation-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-end;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.875rem;
}

.action-btn:hover {
  border-color: #d1d5db;
  background-color: #f9fafb;
}

.approve-btn {
  color: #059669;
}

.approve-btn:hover {
  background-color: #ecfdf5;
  border-color: #a7f3d0;
}

.reject-btn {
  color: #dc2626;
}

.reject-btn:hover {
  background-color: #fef2f2;
  border-color: #fecaca;
}

.disabled-btn {
  color: #9ca3af;
  cursor: not-allowed;
  opacity: 0.6;
}

.disabled-btn:hover {
  background-color: white;
  border-color: #e5e7eb;
}
</style>

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

    <!-- AI : Reject button with dropdown -->
    <div class="reject-button-wrapper">
      <button
        ref="rejectBtn"
        class="action-btn reject-btn"
        :class="{ 'disabled-btn': finalRejectDisabled }"
        @click="toggleMenu"
        :disabled="finalRejectDisabled"
        v-tooltip.top="finalRejectDisabled && disabledTooltip ? disabledTooltip : $t('moderation.rejectChange')"
      >
        <i class="pi pi-times"></i>
        <i class="pi pi-chevron-down dropdown-icon"></i>
      </button>

      <Menu
        ref="menu"
        :model="menuItems"
        :popup="true"
        @hide="isMenuOpen = false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'

// AI : Props for the moderation action buttons
interface Props {
  disabled?: boolean
  disabledTooltip?: string
  approveDisabled?: boolean
  rejectDisabled?: boolean
  userId?: string | null
  showReport?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  disabledTooltip: '',
  approveDisabled: false,
  rejectDisabled: false,
  userId: null,
  showReport: true
})

// AI : Events emitted by the component
const emit = defineEmits<{
  approve: []
  reject: []
  rejectAndReport: []
}>()

const { t } = useI18n()
const menu = ref()
const rejectBtn = ref()
const isMenuOpen = ref(false)

// AI : Computed: Final disabled state for approve button
const finalApproveDisabled = computed(() => props.disabled || props.approveDisabled)

// AI : Computed: Final disabled state for reject button
const finalRejectDisabled = computed(() => props.disabled || props.rejectDisabled)

// AI : Menu items for the dropdown
const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    {
      label: t('moderation.rejectOnly'),
      icon: 'pi pi-times',
      command: () => emit('reject')
    }
  ]

  // AI : Only show "Reject & Report" option if userId is provided and showReport is true
  if (props.userId && props.showReport) {
    items.push({
      label: t('moderation.rejectAndReport'),
      icon: 'pi pi-flag',
      command: () => emit('rejectAndReport')
    })
  }

  return items
})

// AI : Toggle menu visibility
function toggleMenu(event: Event) {
  if (finalRejectDisabled.value) return
  menu.value.toggle(event)
  isMenuOpen.value = !isMenuOpen.value
}
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

.reject-button-wrapper {
  position: relative;
  display: inline-block;
}

.reject-btn {
  color: #dc2626;
  gap: 2px;
  padding: 0 4px;
}

.reject-btn:hover {
  background-color: #fef2f2;
  border-color: #fecaca;
}

.reject-btn .dropdown-icon {
  font-size: 0.625rem;
  opacity: 0.7;
  margin-left: -2px;
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

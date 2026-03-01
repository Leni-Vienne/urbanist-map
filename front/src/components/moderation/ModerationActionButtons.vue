<template>
  <div class="flex flex-col gap-2 items-end">
    <!-- AI : Approve button -->
    <button
      class="w-8 h-8 border border-[var(--p-surface-200)] rounded-md bg-white flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-[var(--p-green-600)] hover:bg-[var(--p-green-50)] hover:border-[var(--p-green-200)] disabled:text-[var(--p-surface-400)] disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
      :disabled="finalApproveDisabled"
      @click="$emit('approve')"
      v-tooltip.top="
        finalApproveDisabled && disabledTooltip ? disabledTooltip : $t('moderation.approveChange')
      "
    >
      <i class="pi pi-check"></i>
    </button>

    <!-- AI : Simple reject button (no dropdown) -->
    <button
      class="w-8 h-8 border border-[var(--p-surface-200)] rounded-md bg-white flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-[var(--p-red-600)] hover:bg-[var(--p-red-50)] hover:border-[var(--p-red-200)] disabled:text-[var(--p-surface-400)] disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
      :disabled="finalRejectDisabled"
      @click="$emit('reject')"
      v-tooltip.top="
        finalRejectDisabled && disabledTooltip ? disabledTooltip : $t('moderation.rejectChange')
      "
    >
      <i class="pi pi-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

// AI : Props for the moderation action buttons
interface Props {
  disabled?: boolean;
  disabledTooltip?: string;
  approveDisabled?: boolean;
  rejectDisabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  disabledTooltip: "",
  approveDisabled: false,
  rejectDisabled: false,
});

// AI : Events emitted by the component
defineEmits<{
  approve: [];
  reject: [];
}>();

// AI : Computed: Final disabled state for approve button
const finalApproveDisabled = computed(() => props.disabled || props.approveDisabled);

// AI : Computed: Final disabled state for reject button
const finalRejectDisabled = computed(() => props.disabled || props.rejectDisabled);
</script>

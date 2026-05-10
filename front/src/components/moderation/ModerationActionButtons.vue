<template>
  <div class="flex flex-col gap-2 items-end">
    <!-- Approve button -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-green-600 hover:bg-green-50 hover:border-green-200 disabled:text-muted-color disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
      :disabled="finalApproveDisabled"
      @click="$emit('approve')"
      v-tooltip.top="
        finalApproveDisabled && disabledTooltip ? disabledTooltip : $t('moderation.approveChange')
      "
    >
      <i class="pi pi-check"></i>
    </button>

    <!-- Simple reject button (no dropdown) -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-600 hover:bg-red-50 hover:border-red-200 disabled:text-muted-color disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
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

defineEmits<{
  approve: [];
  reject: [];
}>();

const finalApproveDisabled = computed(() => props.disabled || props.approveDisabled);
const finalRejectDisabled = computed(() => props.disabled || props.rejectDisabled);
</script>

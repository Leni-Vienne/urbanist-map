<template>
  <div class="flex flex-col gap-2 items-end">
    <!-- Approve button -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-400/12 hover:border-green-200 dark:hover:border-green-400/40 disabled:text-muted-color disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
      :disabled="disabled || loading"
      @click="$emit('approve')"
      v-tooltip.top="disabled && disabledTooltip ? disabledTooltip : $t('moderation.approveChange')"
    >
      <i :class="loading ? 'pi pi-spinner pi-spin' : 'pi pi-check'"></i>
    </button>

    <!-- Simple reject button (no dropdown) -->
    <button
      class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center cursor-pointer transition-all duration-150 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-400/12 hover:border-red-200 dark:hover:border-red-400/40 disabled:text-muted-color disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
      :disabled="disabled || loading"
      @click="$emit('reject')"
      v-tooltip.top="disabled && disabledTooltip ? disabledTooltip : $t('moderation.rejectChange')"
    >
      <i class="pi pi-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
interface Props {
  disabled?: boolean;
  disabledTooltip?: string;
  loading?: boolean;
}

withDefaults(defineProps<Props>(), {
  disabled: false,
  disabledTooltip: "",
  loading: false,
});

defineEmits<{
  approve: [];
  reject: [];
}>();
</script>

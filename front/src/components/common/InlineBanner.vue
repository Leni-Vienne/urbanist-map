<template>
  <div
    class="flex items-center gap-2 p-3 rounded border"
    :class="
      severity === 'error'
        ? 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300'
        : 'bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200'
    "
  >
    <i :class="severity === 'error' ? 'pi pi-exclamation-triangle' : 'pi pi-info-circle'"></i>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ severity: "error" | "info" }>();
</script>

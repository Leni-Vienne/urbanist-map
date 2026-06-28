<template>
  <small
    v-if="show"
    class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
  >
    {{ $t("overlay.changedFrom") }}: "{{ originalValue || $t("overlay.notSet") }}"
  </small>
</template>

<script setup lang="ts">
defineProps<{
  show?: boolean;
  originalValue?: string | number | null;
}>();
</script>

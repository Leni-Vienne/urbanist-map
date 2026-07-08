<template>
  <!-- overflow-x hidden removes the spurious horizontal scrollbar from the sliders -->
  <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
    <FilterPanelContent :show-heading="false" />
  </div>
</template>

<script setup lang="ts">
import FilterPanelContent from "@/components/map/FilterPanelContent.vue";
</script>

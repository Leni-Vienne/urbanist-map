<template>
  <div class="project-selector">
    <ProjectPicker @project-selected="onProjectSelected" />
  </div>
</template>

<script setup lang="ts">
import ProjectPicker from './ProjectPicker.vue';

const emit = defineEmits(['project-selected']);

function onProjectSelected(projectId: string) {
  emit('project-selected', projectId);
}
</script>

<style scoped>
.project-selector {
  padding: 1rem;
  width: 100%;
  max-width: 400px;
  background-color: white;
}
</style>
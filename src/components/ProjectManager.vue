<template>
  <div class="project-manager">
    <router-view />
  </div>
</template>

<script setup lang="ts">
// This component now serves as a wrapper for routing between ProjectList and ProjectEditor
</script>

<style scoped>
.project-manager {
  padding: 1rem;
  max-width: 500px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
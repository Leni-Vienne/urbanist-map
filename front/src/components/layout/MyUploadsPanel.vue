<template>
  <div class="my-uploads-panel">
    <div class="panel-content">
      <h3 class="panel-title">My Uploads</h3>
      
      <!-- AI : Placeholder content for now -->
      <div class="placeholder-state">
        <i class="pi pi-cloud-upload" style="font-size: 3rem; color: var(--p-surface-500); margin-bottom: 1rem;"></i>
        <p>Upload feature coming soon!</p>
        <p class="placeholder-subtitle">This will show your uploaded overlays with status indicators.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// AI : Placeholder component - will be implemented later
</script>

<style scoped>
.my-uploads-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.panel-title {
  margin: 0 0 1rem 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.placeholder-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--p-surface-500);
}

.placeholder-subtitle {
  font-size: 0.875rem;
  margin-top: 0.5rem;
}
</style>
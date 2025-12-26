<template>
  <div class="panel-empty-state">
    <i :class="['pi', iconClass, 'empty-state-icon']"></i>
    <p class="empty-state-message">{{ message }}</p>
    <p v-if="subMessage" class="empty-state-sub-message">{{ subMessage }}</p>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// AI : Props for customizing the empty state
interface Props {
    icon?: string
    message: string
    subMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
    icon: 'folder'
})

// AI : Compute full icon class
const iconClass = computed(() => `pi-${props.icon}`)
</script>

<style scoped>
/* AI : Empty state container - matches existing panel styling */
.panel-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    text-align: center;
    color: var(--p-surface-600);
    height: 100%;
}

.empty-state-icon {
    font-size: 3rem;
    color: var(--p-surface-400);
    margin-bottom: 1rem;
}

.empty-state-message {
    font-size: 1rem;
    margin-bottom: 0.5rem;
    font-weight: 500;
}

.empty-state-sub-message {
    font-size: 0.875rem;
    color: var(--p-surface-500);
}
</style>

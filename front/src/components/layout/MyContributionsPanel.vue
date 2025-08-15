<template>
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    title="My Contributions"
    panel-class="my-contributions-panel"
    :empty-message="projects.length > 0 && filteredProjects.length === 0 ? 'No projects match the current filter.' : 'No projects found.'"
    :empty-sub-message="projects.length > 0 && filteredProjects.length === 0 ? 'Try changing your filter settings.' : 'Create your first construction project!'"
  >
    <template #header-actions>
      <div class="filter-controls">
        <div class="field-checkbox">
          <Checkbox v-model="showApprovedRejected" inputId="showApprovedRejected" binary />
          <label for="showApprovedRejected">Show all</label>
        </div>
      </div>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { trpc } from '../../client'
import Checkbox from 'primevue/checkbox'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'

// AI : Reactive state
const projects = ref<any[]>([])
const isLoading = ref(false)
const showApprovedRejected = ref(false)

// AI : Computed filtered projects
const filteredProjects = computed(() => {
  if (showApprovedRejected.value) {
    return projects.value
  }
  return projects.value.filter(project => project.status === 'pending')
})

// AI : Fetch all projects from API
async function fetchAllProjects() {
  try {
    isLoading.value = true
    const result = await trpc.project.getUsersContributions.query({
      limit: 50
    })
    projects.value = result
  } catch (error) {
    console.error('Error fetching projects:', error)
  } finally {
    isLoading.value = false
  }
}

// AI : Load initial data
onMounted(() => {
  fetchAllProjects()
})
</script>

<style scoped>
/* AI : Component-specific styles - most moved to shared component */
.filter-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-checkbox label {
  font-size: 0.875rem;
  color: var(--p-surface-600);
  cursor: pointer;
}
</style>
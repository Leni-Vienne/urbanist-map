<template>
  <div class="project-header mb-3">
    <h4 class="text-lg font-bold">{{ project.name }}</h4>
    <p
      v-if="project.description"
      class="text-sm mb-2"
    >
      {{ project.description }}
    </p>
    <div class="text-sm text-gray-600">
      <div v-if="project.location">Location: {{ project.location }}</div>
      <div v-if="project.sourceUrl">
        Source: <a
          :href="project.sourceUrl"
          target="_blank"
          class="text-blue-600 hover:underline"
        >{{ project.sourceUrl }}</a>
      </div>
      <div v-if="project.startDate">
        Period: {{ formatDate(project.startDate) }} -
        {{ project.endDate ? formatDate(project.endDate) : 'Ongoing' }}
      </div>
      <div v-if="project.latestUpdateOn">
        Latest Update: {{ formatDate(project.latestUpdateOn) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Project } from '@types';

interface Props {
  project: Project;
  formatDate: (date: Date | null) => string;
}

defineProps<Props>();
</script>

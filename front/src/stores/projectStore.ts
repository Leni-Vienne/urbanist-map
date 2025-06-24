import { ref } from 'vue';
import type { Project } from '@types';

// AI : Central store for project data to avoid circular dependencies
export const projects = ref<Record<string, Project>>({});
export const selectedProjectId = ref<string | null>(null);
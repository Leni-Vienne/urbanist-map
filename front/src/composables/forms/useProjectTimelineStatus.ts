import { ref, computed, watch } from 'vue'
import type { Project } from '@/types/index'
import type { ProjectFormData } from '../../types/forms'

export function useProjectTimelineStatus(project: Partial<Project>, formData?: ProjectFormData) {
  // AI : Determine initial timeline status based on project data
  const initialIsProposed = computed(() => {
    // AI : Project is proposed if it has proposalDate but no startDate/endDate
    return !!(project.proposalDate && !project.startDate && !project.endDate)
  })

  // AI : Track if project is proposed or planned (timeline status)
  const isProposed = ref<boolean>(initialIsProposed.value)

  // AI : Toggle between proposed and planned timeline status
  function toggleTimelineStatus(newIsProposed: boolean, targetFormData?: ProjectFormData) {
    isProposed.value = newIsProposed
    
    const data = targetFormData ?? formData
    if (!data) return

    if (newIsProposed) {
      // AI : Switching to proposed - clear planned dates
      data.startDate = null
      data.endDate = null
    } else {
      // AI : Switching to planned - clear proposal date
      data.proposalDate = null
      // AI : Restore original dates if switching back
      if (project.startDate && !data.startDate) {
        data.startDate = project.startDate
      }
      if (project.endDate && !data.endDate) {
        data.endDate = project.endDate
      }
    }
  }

  // AI : Watch for changes and update dates accordingly (for CreateProjectForm)
  if (formData) {
    watch(isProposed, (newValue) => {
      if (newValue) {
        // AI : Switching to proposed - clear planned dates
        formData.startDate = null
        formData.endDate = null
      } else {
        // AI : Switching to planned - clear proposal date and restore original planned dates if available
        formData.proposalDate = null
        if (project.startDate) {
          formData.startDate = project.startDate
        }
        if (project.endDate) {
          formData.endDate = project.endDate
        }
      }
    })
  }

  return {
    isProposed,
    toggleTimelineStatus
  }
}

import { useI18n } from 'vue-i18n'
import { useToast } from '@composables/ui/useToast'
import type { ProjectFormData } from '@components/forms/ProjectFormFields.vue'

// AI : Shared validation logic for project forms
export function useProjectFormValidation() {
  const { t } = useI18n()
  const toast = useToast()

  function showError(detail: string) {
    toast.add({
      severity: 'error',
      summary: t('project.validationError'),
      detail,
      life: 3000
    })
  }

  function validateProjectForm(
    formData: ProjectFormData,
    isProposed: boolean,
    cities: Array<{ id: string }>,
    citiesLoaded: boolean
  ): boolean {
    if (!formData.name?.trim()) {
      showError(t('project.nameRequired'))
      return false
    }

    if (formData.name.trim().length < 8) {
      showError(t('project.nameTooShort'))
      return false
    }

    if (!formData.cityId || !citiesLoaded) {
      showError(t('project.locationRequired'))
      return false
    }

    if (cities.length > 0 && !cities.find(c => c.id === formData.cityId)) {
      showError(t('project.locationRequired'))
      return false
    }

    if (isProposed) {
      if (!formData.proposalDate) {
        showError(t('project.proposalDateRequired'))
        return false
      }
    } else if (!formData.startDate || !formData.endDate) {
      showError(t('project.datesRequired'))
      return false
    }

    return true
  }

  return { validateProjectForm }
}

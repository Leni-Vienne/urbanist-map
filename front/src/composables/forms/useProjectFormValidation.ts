import { useI18n } from '@composables/useI18n'
import { useToast } from '@composables/ui/useToast'
import type { ProjectFormData } from '../../types/forms'
import { projectSchema, getValidationErrorsMap } from '@shared/validation/schemas'

// AI : Shared validation logic for project forms using Zod
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
    cities: { id: string }[],
    citiesLoaded: boolean
  ): boolean {
    // AI : City-related checks (not covered by Zod schema)
    if (!formData.cityId || !citiesLoaded) {
      showError(t('project.locationRequired'))
      return false
    }

    if (cities.length > 0 && !cities.find(c => c.id === formData.cityId)) {
      showError(t('project.locationRequired'))
      return false
    }

    // AI : Validate with Zod schema (use dummy lat/lng for form-level validation)
    // AI : Transform null values to empty strings to match schema expectations
    const validationData = { 
      ...formData, 
      lat: 0, 
      lng: 0,
      description: formData.description ?? '',
      sourceUrl: formData.sourceUrl ?? ''
    }
    const result = projectSchema.safeParse(validationData)

    if (!result.success) {
      // AI : Get first error and show it
      const errors = getValidationErrorsMap(result.error)
      const firstError = Object.values(errors)[0]
      showError(t(firstError.key, firstError.params ?? {}))
      return false
    }

    return true
  }

  return { validateProjectForm }
}

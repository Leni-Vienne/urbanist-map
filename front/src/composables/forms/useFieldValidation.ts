// AI : Frontend composable for Zod validation with i18n error mapping
import { ref, computed } from 'vue'
import { useI18n } from '@composables/useI18n'
import { type z } from 'zod'
import { getValidationError, getValidationErrorsMap, type ValidationError } from '@shared/validation/schemas'

// AI : Composable for reactive field validation
export function useFieldValidation<T>(schema: z.ZodType<T>) {
  const { t } = useI18n()
  
  // AI : Map of field paths to ValidationError (key + params)
  const fieldErrors = ref<Record<string, ValidationError>>({})
  
  // AI : Track which fields have been touched (validated at least once)
  const touchedFields = ref<Set<string>>(new Set())

  // AI : Validate entire form data
  function validateForm(data: T): { success: boolean; errors: Record<string, ValidationError> } {
    const result = schema.safeParse(data)
    
    if (result.success) {
      fieldErrors.value = {}
      return { success: true, errors: {} }
    }
    
    const errors = getValidationErrorsMap(result.error)
    fieldErrors.value = errors
    return { success: false, errors }
  }

  // AI : Validate a single field - now validates on input after first blur
  function validateField(fieldPath: string, data: T): ValidationError | null {
    // AI : Mark field as touched
    touchedFields.value.add(fieldPath)
    
    const result = schema.safeParse(data)
    
    if (result.success) {
      // AI : Clear error for this field
      const { [fieldPath]: _, ...rest } = fieldErrors.value
      fieldErrors.value = rest
      return null
    }
    
    const error = getValidationError(result.error, fieldPath)
    
    if (error.key !== 'validation.genericError') {
      fieldErrors.value[fieldPath] = error
      return error
    } else {
      // AI : Clear error if no error found for this field
      const { [fieldPath]: _, ...rest } = fieldErrors.value
      fieldErrors.value = rest
      return null
    }
  }

  // AI : Get translated error message for a field
  function getFieldError(fieldPath: string): string | null {
    const error = fieldErrors.value[fieldPath]
    return error ? t(error.key, error.params ?? {}) : null
  }

  // AI : Check if a field has an error
  function hasFieldError(fieldPath: string): boolean {
    return !!fieldErrors.value[fieldPath]
  }
  
  // AI : Check if a field has been touched (validated at least once)
  function isFieldTouched(fieldPath: string): boolean {
    return touchedFields.value.has(fieldPath)
  }

  // AI : Clear all errors
  function clearErrors() {
    fieldErrors.value = {}
  }

  // AI : Clear error for a specific field (but keep it as touched)
  function clearFieldError(fieldPath: string) {
    const { [fieldPath]: _, ...rest } = fieldErrors.value
    fieldErrors.value = rest
  }

  // AI : Computed property to check if form has any errors
  const hasErrors = computed(() => Object.keys(fieldErrors.value).length > 0)

  return {
    fieldErrors,
    validateForm,
    validateField,
    getFieldError,
    hasFieldError,
    isFieldTouched,
    clearErrors,
    clearFieldError,
    hasErrors
  }
}

// AI : Helper to create a partial schema for single field validation
export function createFieldValidator<T>(schema: z.ZodType<T>, fieldPath: string) {
  return (value: any, fullData?: T) => {
    // AI : If full data is provided, validate the entire object
    // AI : Otherwise, create a partial object with just this field
    const dataToValidate = fullData ?? { [fieldPath]: value } as T
    const result = schema.safeParse(dataToValidate)
    
    if (result.success) {
      return null
    }
    
    return getValidationError(result.error, fieldPath)
  }
}

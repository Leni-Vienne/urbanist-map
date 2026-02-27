// AI : Frontend composable for Zod validation with i18n error mapping
import { ref } from "vue";
import { t } from "@/locales";
import type { z } from "zod";
import { getValidationError, type ValidationError } from "@shared/validation/schemas";

// AI : Composable for reactive field validation
export function useFieldValidation<T>(schema: z.ZodType<T>) {
  // AI : Map of field paths to ValidationError (key + params)
  const fieldErrors = ref<Record<string, ValidationError>>({});

  // AI : Track which fields have been touched (validated at least once)
  const touchedFields = ref<Set<string>>(new Set());

  // AI : Validate a single field - now validates on input after first blur
  function validateField(fieldPath: string, data: T): ValidationError | null {
    // AI : Mark field as touched
    touchedFields.value.add(fieldPath);

    const result = schema.safeParse(data);

    if (result.success) {
      // AI : Clear error for this field
      const { [fieldPath]: _, ...rest } = fieldErrors.value;
      fieldErrors.value = rest;
      return null;
    }

    const error = getValidationError(result.error, fieldPath);

    if (error.key !== "validation.genericError") {
      fieldErrors.value[fieldPath] = error;
      return error;
    } else {
      // AI : Clear error if no error found for this field
      const { [fieldPath]: _, ...rest } = fieldErrors.value;
      fieldErrors.value = rest;
      return null;
    }
  }

  // AI : Get translated error message for a field
  function getFieldError(fieldPath: string): string | null {
    const error = fieldErrors.value[fieldPath];
    return error ? t(error.key, error.params ?? {}) : null;
  }

  // AI : Check if a field has an error
  function hasFieldError(fieldPath: string): boolean {
    return Boolean(fieldErrors.value[fieldPath]);
  }

  return {
    validateField,
    getFieldError,
    hasFieldError,
  };
}

// Frontend composable for Zod validation with i18n error mapping
import { ref } from "vue";
import { t } from "@/locales";
import type { z } from "zod";
import { getValidationError, type ValidationError } from "@shared/validation/schemas";

// Composable for reactive field validation
export function useFieldValidation<T>(schema: z.ZodType<T>) {
  // Map of field paths to ValidationError (key + params)
  const fieldErrors = ref<Record<string, ValidationError>>({});

  // Track which fields have been touched (validated at least once)
  const touchedFields = ref<Set<string>>(new Set());

  // Validate a single field - now validates on input after first blur
  function validateField(fieldPath: string, data: T): ValidationError | null {
    // Mark field as touched
    touchedFields.value.add(fieldPath);

    const result = schema.safeParse(data);

    if (result.success) {
      // Clear error for this field
      const { [fieldPath]: _, ...rest } = fieldErrors.value;
      fieldErrors.value = rest;
      return null;
    }

    const error = getValidationError(result.error, fieldPath);

    if (error.key !== "validation.genericError") {
      fieldErrors.value[fieldPath] = error;
      return error;
    } else {
      // Clear error if no error found for this field
      const { [fieldPath]: _, ...rest } = fieldErrors.value;
      fieldErrors.value = rest;
      return null;
    }
  }

  // Get translated error message for a field
  function getFieldError(fieldPath: string): string | null {
    const error = fieldErrors.value[fieldPath];
    return error ? t(error.key, error.params ?? {}) : null;
  }

  // Check if a field has an error
  function hasFieldError(fieldPath: string): boolean {
    return Boolean(fieldErrors.value[fieldPath]);
  }

  return {
    validateField,
    getFieldError,
    hasFieldError,
  };
}

import { ref } from "vue";
import { t } from "@/locales";
import type { z } from "zod";
import { getValidationError, type ValidationError } from "@shared/validation/schemas";

export function useFieldValidation<T>(schema: z.ZodType<T>) {
  const fieldErrors = ref<Record<string, ValidationError>>({});
  const touchedFields = ref<Set<string>>(new Set());

  function validateField(fieldPath: string, data: T): ValidationError | null {
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
      const { [fieldPath]: _, ...rest } = fieldErrors.value;
      fieldErrors.value = rest;
      return null;
    }
  }

  function getFieldError(fieldPath: string): string | null {
    const error = fieldErrors.value[fieldPath];
    return error ? t(error.key, error.params ?? {}) : null;
  }

  function hasFieldError(fieldPath: string): boolean {
    return Boolean(fieldErrors.value[fieldPath]);
  }

  return {
    validateField,
    getFieldError,
    hasFieldError,
  };
}

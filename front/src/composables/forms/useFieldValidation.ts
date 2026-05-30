import { ref } from "vue";
import { t } from "@/locales";
import type { z } from "zod";
import { getValidationError, type ValidationError } from "@shared/validation/schemas";

export function useFieldValidation<T>(schema: z.ZodType<T>) {
  const fieldErrors = ref<Record<string, ValidationError>>({});

  function clearFieldError(fieldPath: string): void {
    const { [fieldPath]: _, ...rest } = fieldErrors.value;
    fieldErrors.value = rest;
  }

  function validateField(fieldPath: string, data: T): void {
    const result = schema.safeParse(data);

    if (result.success) {
      clearFieldError(fieldPath);
      return;
    }

    const error = getValidationError(result.error, fieldPath);

    if (error.key !== "validation.genericError") {
      fieldErrors.value[fieldPath] = error;
    } else {
      clearFieldError(fieldPath);
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

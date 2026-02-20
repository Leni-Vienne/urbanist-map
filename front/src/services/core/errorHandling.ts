// AI : Unified error handling utilities to eliminate repetitive try-catch-toast patterns
import { useToast } from "@/composables/ui/useToast";

interface ErrorHandlingOptions {
  /** Toast message to show on error */
  errorMessage?: string;
  /** Toast message to show on success */
  successMessage?: string;
  /** Toast summary for error (default: 'Error') */
  errorSummary?: string;
  /** Toast summary for success (default: 'Success') */
  successSummary?: string;
  /** Whether to log error to console (default: true) */
  logError?: boolean;
  /** Whether to rethrow error after handling (default: false) */
  rethrow?: boolean;
  /** Custom error handler function */
  onError?: (error: unknown) => void;
  /** Custom success handler function */
  onSuccess?: <T>(result: T) => void;
}

/**
 * AI : Execute a sync or async function with automatic error handling and toast notifications
 *
 * @example
 * const result = await withErrorHandling(
 *   () => trpc.project.create.mutate(data),
 *   { successMessage: 'Project created!', errorMessage: 'Failed to create project' }
 * )
 */
export async function withErrorHandling<T>(
  fn: () => T | Promise<T>,
  options: ErrorHandlingOptions = {},
): Promise<T | null> {
  const {
    errorMessage,
    successMessage,
    errorSummary = "Error",
    successSummary = "Success",
    logError = true,
    rethrow = false,
    onError,
    onSuccess,
  } = options;

  const toast = useToast();

  try {
    const result = await fn();

    // AI : Show success toast if provided
    if (successMessage != undefined) {
      toast.add({
        severity: "success",
        summary: successSummary,
        detail: successMessage,
        life: 3000,
      });
    }

    // AI : Call custom success handler
    if (onSuccess) {
      onSuccess(result);
    }

    return result;
  } catch (error) {
    // AI : Log error to console
    if (logError) {
      console.error(errorMessage ?? "Error occurred:", error);
    }

    // AI : Show error toast
    if (errorMessage) {
      toast.add({
        severity: "error",
        summary: errorSummary,
        detail: errorMessage,
        life: 5000,
      });
    }

    // AI : Call custom error handler
    if (onError) {
      onError(error);
    }

    // AI : Rethrow if requested
    if (rethrow) {
      throw error;
    }

    return null;
  }
}

/**
 * AI : Execute a sync or async function with error toast notification (always returns result or throws)
 * Use this when you want the error to propagate but still show a toast
 *
 * @example
 * const result = await withErrorToast(
 *   () => trpc.project.delete.mutate(id),
 *   'Failed to delete project'
 * )
 */
export async function withErrorToast<T>(
  fn: () => T | Promise<T>,
  errorMessage: string,
): Promise<T> {
  return withErrorHandling(fn, { errorMessage, rethrow: true }) as Promise<T>;
}

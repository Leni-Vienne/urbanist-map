// AI : Unified error handling utilities to eliminate repetitive try-catch-toast patterns
import { useToast } from '@composables/ui/useToast'

export interface ErrorHandlingOptions {
  /** Toast message to show on error */
  errorMessage?: string
  /** Toast message to show on success */
  successMessage?: string
  /** Whether to log error to console (default: true) */
  logError?: boolean
  /** Whether to rethrow error after handling (default: false) */
  rethrow?: boolean
  /** Custom error handler function */
  onError?: (error: unknown) => void
  /** Custom success handler function */
  onSuccess?: <T>(result: T) => void
}

/**
 * AI : Execute an async function with automatic error handling and toast notifications
 *
 * @example
 * const result = await withErrorHandling(
 *   () => trpc.project.create.mutate(data),
 *   { successMessage: 'Project created!', errorMessage: 'Failed to create project' }
 * )
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: ErrorHandlingOptions = {}
): Promise<T | null> {
  const {
    errorMessage,
    successMessage,
    logError = true,
    rethrow = false,
    onError,
    onSuccess,
  } = options

  const toast = useToast()

  try {
    const result = await fn()

    // AI : Show success toast if provided
    if (successMessage) {
      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: successMessage,
        life: 3000,
      })
    }

    // AI : Call custom success handler
    if (onSuccess) {
      onSuccess(result)
    }

    return result
  } catch (error) {
    // AI : Log error to console
    if (logError) {
      console.error(errorMessage ?? 'Error occurred:', error)
    }

    // AI : Show error toast
    if (errorMessage) {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: errorMessage,
        life: 5000,
      })
    }

    // AI : Call custom error handler
    if (onError) {
      onError(error)
    }

    // AI : Rethrow if requested
    if (rethrow) {
      throw error
    }

    return null
  }
}

/**
 * AI : Execute an async function with error toast notification (always returns result or throws)
 * Use this when you want the error to propagate but still show a toast
 *
 * @example
 * const result = await withErrorToast(
 *   () => trpc.project.delete.mutate(id),
 *   'Failed to delete project'
 * )
 */
export async function withErrorToast<T>(
  fn: () => Promise<T>,
  errorMessage: string
): Promise<T> {
  return withErrorHandling(fn, { errorMessage, rethrow: true }) as Promise<T>;
}

/**
 * AI : Execute an async function with both success and error toast notifications
 *
 * @example
 * await withToasts(
 *   () => trpc.project.update.mutate(data),
 *   'Project updated successfully!',
 *   'Failed to update project'
 * )
 */
export async function withToasts<T>(
  fn: () => Promise<T>,
  successMessage: string,
  errorMessage: string
): Promise<T | null> {
  return withErrorHandling(fn, { successMessage, errorMessage })
}

/**
 * AI : Wrap a function to automatically handle errors with toast notifications
 * Useful for event handlers and callbacks
 *
 * @example
 * const handleSubmit = wrapWithErrorHandling(
 *   async () => { await saveData() },
 *   { successMessage: 'Saved!', errorMessage: 'Failed to save' }
 * )
 */
export function wrapWithErrorHandling<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: ErrorHandlingOptions = {}
): (...args: TArgs) => Promise<TReturn | null> {
  return async (...args: TArgs) => {
    return withErrorHandling(() => fn(...args), options)
  }
}

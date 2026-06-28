// Unified error handling utility for safe loading
import { useToast } from "@/composables/ui/useToast";

interface ErrorHandlingOptions {
  /** Toast message to show on error */
  errorMessage?: string;
  /** Whether to rethrow error after handling (default: false) */
  rethrow?: boolean;
}

/**
 * Execute a sync or async function with automatic error logging and optional toast notifications
 * Returns null if an error occurs.
 *
 * @example
 * const result = await loadOrNull(
 *   () => trpc.project.getById.query(id),
 *   { errorMessage: 'Failed to load project' }
 * )
 */
export async function loadOrNull<T>(
  fn: () => T | Promise<T>,
  options: ErrorHandlingOptions = {},
): Promise<T | null> {
  const { errorMessage, rethrow = false } = options;

  const toast = useToast();

  try {
    return await fn();
  } catch (error) {
    console.error(errorMessage ?? "Error occurred:", error);

    if (errorMessage) {
      toast.add({
        severity: "error",
        summary: "Error",
        detail: errorMessage,
        life: 5000,
      });
    }

    if (rethrow) {
      throw error;
    }

    return null;
  }
}

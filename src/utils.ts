// Common utility functions for the application

/**
 * Creates a debounced function that delays invoking the provided function
 * until after the specified wait time has elapsed since the last invocation.
 *
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the provided function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T, 
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  
  return function(...args: Parameters<T>): void {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait) as unknown as number;
  };
}

/**
 * Truncates a string to the specified length and adds an ellipsis if truncated
 * 
 * @param str - The string to truncate
 * @param maxLength - Maximum length before truncation 
 * @returns The truncated string
 */
export function truncateString(str: string, maxLength: number): string {
  if (!str) return '';
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

/**
 * Safely gets a value from a potentially undefined object
 * 
 * @param obj - The object to get a value from
 * @param key - The key to get from the object
 * @param defaultValue - The default value to return if the key doesn't exist
 * @returns The value at the key or the default value
 */
export function safeGet<T, K extends keyof T>(
  obj: T | null | undefined,
  key: K,
  defaultValue: T[K]
): T[K] {
  return obj && obj[key] !== undefined ? obj[key] : defaultValue;
}
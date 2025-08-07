// AI : Common utility functions for the application

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
 * AI : Build image URL for overlay files
 * AI : Uses direct R2 public URL in production to avoid worker CPU usage
 * @param filename - The filename of the image
 * @returns The complete URL to access the image
 */
export function buildImageUrl(filename: string): string {
  console.log('env ;', import.meta.env);
  // AI : In production, use direct R2 public URL to bypass worker
  if (import.meta.env.PROD) {
    
    const r2PublicUrl = import.meta.env.VITE_R2_PUBLIC_URL;
    return `${r2PublicUrl}/${filename}`;
  }
  
  // AI : In development, use local server
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  return `${apiBaseUrl}/uploads/${filename}`;
}
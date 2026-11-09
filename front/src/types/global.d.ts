// Type definitions for globalThis extensions
declare global {
  // Cloudflare Turnstile types
  var turnstile:
    | {
        render: (container: string | HTMLElement, options: any) => string;
        remove: (widgetId: string) => void;
        reset: (widgetId: string) => void;
      }
    | undefined;
}

// eslint-disable-next-line require-module-specifiers
export {};

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

  // Google Identity Services types
  var google:
    | {
        accounts: {
          id: {
            initialize: (config: {
              client_id: string;
              callback: (response: { credential: string }) => void;
              auto_select?: boolean;
              cancel_on_tap_outside?: boolean;
            }) => void;
            prompt: (
              callback?: (notification: {
                isNotDisplayed?: () => boolean;
                isSkippedMoment?: () => boolean;
              }) => void,
            ) => void;
          };
        };
      }
    | undefined;
}

// eslint-disable-next-line require-module-specifiers
export {};

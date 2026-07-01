import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../back/src/routes";
import superjson from "superjson";

export type RouterOutput = inferRouterOutputs<AppRouter>;

// Get API URL based on environment.
// In dev with no explicit base, use the page's own origin so requests go through the
// Vite proxy (see vite.config.ts). This keeps the backend same-origin as the page, so
// the session cookie stays first-party whether the page is loaded via localhost or a LAN IP.
export function getApiUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (!configured && import.meta.env.DEV) {
    return globalThis.location.origin;
  }
  return configured;
}

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getApiUrl()}/trpc`,

      async fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include", // Include cookies in requests
        });
      },
      transformer: superjson, // Send Date datatype
    }),
  ],
});

// Export as named export to prevent tree-shaking issues
export { trpc };

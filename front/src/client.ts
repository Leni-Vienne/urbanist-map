import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs, inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../back/src/routes";
import superjson from "superjson";

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;

// Get API URL based on environment
export function getApiUrl() {
  return import.meta.env.VITE_API_BASE_URL;
}

// Pass AppRouter as generic here. 👇 This lets the `trpc` object know
// What procedures are available on the server and their input/output types.
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

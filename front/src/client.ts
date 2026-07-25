import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../back/src/routes";
import superjson from "superjson";
import { getApiUrl } from "@/utils/apiUrl";

export type RouterOutput = inferRouterOutputs<AppRouter>;

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

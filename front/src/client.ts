import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../back/src/routes";
import superjson from "superjson";
import { getApiUrl } from "@/utils/apiUrl";

export type RouterOutput = inferRouterOutputs<AppRouter>;

const httpOptions = {
  url: `${getApiUrl()}/trpc`,

  async fetch(url: URL | RequestInfo, options?: RequestInit) {
    return fetch(url, {
      ...options,
      credentials: "include", // Include cookies in requests
    });
  },
  transformer: superjson, // Send Date datatype
};

// A batched response is delivered whole, so one slow procedure holds back every call sharing its
// batch. Passing `context: { skipBatch: true }` gives a call its own request, which is worth the
// extra round trip for a slow procedure whose result nothing is waiting on.
const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.context.skipBatch === true,
      true: httpLink(httpOptions),
      false: httpBatchLink(httpOptions),
    }),
  ],
});

// Export as named export to prevent tree-shaking issues
export { trpc };

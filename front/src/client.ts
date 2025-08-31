import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '../../back/src/shared/routers';
import superjson from 'superjson';

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;

// AI : Get API URL based on environment
export const getApiUrl = () => {
  return import.meta.env.VITE_API_BASE_URL;
};

// Pass AppRouter as generic here. 👇 This lets the `trpc` object know
// what procedures are available on the server and their input/output types.
const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getApiUrl()}/trpc`,
      
      async fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: 'include', // AI : Include cookies in requests
        });
      },
      transformer: superjson, // AI : Send Date datatype
    }),
  ],
});

// AI : Export as named export to prevent tree-shaking issues
export { trpc };


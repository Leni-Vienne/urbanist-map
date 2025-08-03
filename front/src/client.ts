import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '../../back/src/shared/routers';
import superjson from 'superjson';

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;

// AI : Get API URL based on environment
const getApiUrl = () => {
  // AI : In production, use relative URL since frontend and backend are served from same Worker
  if (import.meta.env.PROD) {
    return ''; // AI : Same origin, no need for full URL
  }
  // AI : In development, use local server or configured URL
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
};

// Pass AppRouter as generic here. 👇 This lets the `trpc` object know
// what procedures are available on the server and their input/output types.
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getApiUrl()}/trpc`,
      
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: 'include',
        });
      },
      transformer: superjson, // to send Date datatype
    }),
  ],
});

export function isTRPCClientError(
  cause: unknown,
): cause is TRPCClientError<AppRouter> {
  return cause instanceof TRPCClientError;
}
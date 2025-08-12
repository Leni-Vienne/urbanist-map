import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '../../back/src/shared/routers';
import { supabase } from './lib/supabase';
import superjson from 'superjson';

// AI : Get Supabase access token
async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

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
      
      async fetch(url, options) {
        const token = await getAuthToken();
        const headers = {
          ...options?.headers,
        };
        
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        return fetch(url, {
          ...options,
          headers,
          credentials: 'include',
        });
      },
      transformer: superjson, // AI : Send Date datatype
    }),
  ],
});

export function isTRPCClientError(
  cause: unknown,
): cause is TRPCClientError<AppRouter> {
  return cause instanceof TRPCClientError;
}
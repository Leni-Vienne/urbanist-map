import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { DBUser } from './db/schema';
import type { Context as HonoContext } from 'hono';

export { TRPCError } from '@trpc/server';

export type Context = {
    user?: DBUser | null;
    hono?: HonoContext;
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
    transformer: superjson,  // AI : to send Date datatype
    errorFormatter({ shape, error }) {
        // AI : Handle Zod validation errors with custom messages
        if (error.code === 'BAD_REQUEST' && error.cause?.name === 'ZodError') {
            const zodError = error.cause as any;
            const firstError = zodError.issues?.[0];
            if (firstError?.message) {
                return {
                    ...shape,
                    message: firstError.message,
                };
            }
        }
        return shape;
    },
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

export const isAuthed = t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
    }
    return next({
        ctx: {
            user: ctx.user,
        },
    });
});

// AI : Middleware to check if user has admin role
export const isModerator = t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
    }
    if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
    }
    return next({
        ctx: {
            user: ctx.user,
        },
    });
});

export const protectedProcedure = t.procedure.use(isAuthed);
export const adminProcedure = t.procedure.use(isModerator);

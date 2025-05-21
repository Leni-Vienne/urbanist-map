import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { Session } from 'hono-sessions'

export type Context = {
    session?: Session & {
        userId?: string;
        isAuthenticated?: boolean;
        username?: string;
    }
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
    transformer: superjson,  // to send Date datatype
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

export const isAuthed = t.middleware(({ ctx, next }) => {
    if (!ctx.session?.isAuthenticated) {
        throw new Error('Not authenticated');
    }
    return next({
        ctx: {
            session: ctx.session,
        },
    });
});


export const protectedProcedure = t.procedure.use(isAuthed);
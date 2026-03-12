import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { DBUser } from "./db/schema";
import type { Context as HonoContext } from "hono";

export { TRPCError } from "@trpc/server";

type Context = {
  user?: DBUser | null;
  hono: HonoContext;
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson, // to send Date datatype
  errorFormatter({ shape, error }) {
    // Handle Zod validation errors with custom messages
    if (error.code === "BAD_REQUEST" && error.cause?.name === "ZodError") {
      const zodError = error.cause as any;
      const firstError = zodError.issues?.[0];
      if (firstError?.message) {
        return {
          ...shape,
          message: firstError.message,
        };
      }
    }

    // Strip stack traces and internal paths from client-facing errors
    // Only show clean error messages to users
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: undefined, // To never expose stack traces to clients. Is there a better way ?
      },
    };
  },
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthedMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

// Middleware to check if user has admin role
const isAdminMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

// Middleware to check if user is admin or moderator (has moderatedCountries)
const isModeratorOrAdminMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }

  // Allow access if user is admin OR has moderatedCountries (is a moderator)
  const isAdmin = ctx.user.role === "admin";
  const isModerator = ctx.user.moderatedCountries !== null;

  if (!isAdmin && !isModerator) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Moderator or admin access required" });
  }

  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

export const loggedInProcedure = t.procedure.use(isAuthedMiddleware);
export const adminProcedure = t.procedure.use(isAdminMiddleware);
export const moderatorProcedure = t.procedure.use(isModeratorOrAdminMiddleware);

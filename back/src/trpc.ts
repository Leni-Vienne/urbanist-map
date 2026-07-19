import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { SessionUser } from "./lib/types";
import type { Context as HonoContext } from "hono";
import { isModeratorOrAdmin } from "./db/helpers";

export { TRPCError } from "@trpc/server";

type Context = {
  user?: SessionUser | null;
  hono: HonoContext;
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson, // to send Date datatype
  errorFormatter({ shape, error }) {
    const safeShape = {
      ...shape,
      data: {
        ...shape.data,
        stack: undefined,
      },
    };

    // Handle Zod validation errors with custom messages
    if (error.code === "BAD_REQUEST" && error.cause?.name === "ZodError") {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const zodError = error.cause as any;
      const firstError = zodError.issues?.[0];
      if (firstError?.message) {
        return {
          ...safeShape,
          message: firstError.message,
        };
      }
    }

    return safeShape;
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

// Middleware to check if user is admin or moderator (has moderatedCountries set with at least one country)
const isModeratorOrAdminMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }

  if (!isModeratorOrAdmin(ctx.user)) {
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

import { Context, Next } from 'hono'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { db } from '../database'
import { users } from '../db/schema'
import type { DBUser } from '../db/schema'
import { getCookie } from 'hono/cookie'

// AI : Get user from user ID stored in cookie
export async function getUserFromCookie(c: Context): Promise<DBUser | null> {
  try {
    const userId = getCookie(c, 'user_id')
    
    if (!userId) {
      return null
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user || !user.emailVerified) {
      return null
    }

    return user
  } catch (error) {
    console.error('Get user from cookie error:', error)
    return null
  }
}

// AI : Custom auth middleware for cookie-based authentication
export function createAuthMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      const user = await getUserFromCookie(c)
      c.set('user', user)
      return await next()
      
    } catch (error) {
      console.error('Auth middleware error:', error)
      c.set('user', null)
      return await next()
    }
  }
}

// AI : Helper to get authenticated user from Hono context
export function getAuthenticatedUser(c: Context): DBUser | null {
  return c.get('user') ?? null
}

// AI : Helper to require authentication
export function requireAuth(c: Context): DBUser {
  const user = getAuthenticatedUser(c)
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return user
}

// AI : Helper to require specific role
export function requireRole(c: Context, role: string): DBUser {
  const user = requireAuth(c)
  if (user.role !== role && user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' })
  }
  return user
}

// AI : Helper to require admin role
export function requireAdmin(c: Context): DBUser {
  return requireRole(c, 'admin')
}
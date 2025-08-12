import * as jose from 'jose'
import { Context, Next } from 'hono'
import { TRPCError } from '@trpc/server'

// AI : Lightweight user type from JWT payload (no external dependencies)
export interface AuthUser {
  id: string
  email?: string
  user_metadata?: {
    username?: string
  }
  role?: string
}

// AI : Extract JWT token from Authorization header
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null
  
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  
  return parts[1]
}

// AI : Lightweight JWT verification using Supabase JWT secret
export async function verifySupabaseJWT(token: string, jwtSecret: string): Promise<AuthUser | null> {
  try {
    const secret = new TextEncoder().encode(jwtSecret)
    const { payload } = await jose.jwtVerify(token, secret)
    
    return {
      id: payload.sub as string,
      email: payload.email as string,
      user_metadata: payload.user_metadata as { username?: string },
      role: payload.role as string
    }
  } catch (error) {
    console.error('JWT verification failed:', error)
    return null
  }
}

// AI : Hono middleware for JWT authentication (no Supabase client needed)
export function createSupabaseAuthMiddleware(jwtSecret: string) {
  return async (c: Context, next: Next) => {
    try {
      const authHeader = c.req.header('Authorization')
      const token = extractBearerToken(authHeader)
      
      console.log('Auth middleware - JWT secret exists:', !!jwtSecret)
      console.log('Auth middleware - Token exists:', !!token)
      
      if (!token) {
        c.set('user', null)
        return next()
      }

      const user = await verifySupabaseJWT(token, jwtSecret)
      console.log('Auth middleware - User verified:', !!user, user?.email)
      c.set('user', user)
      return next()
      
    } catch (error) {
      console.error('Supabase auth middleware error:', error)
      c.set('user', null)
      return next()
    }
  }
}

// AI : Helper to get authenticated user from Hono context
export function getAuthenticatedUser(c: Context): AuthUser | null {
  return c.get('user') ?? null
}

// AI : Helper to require authentication
export function requireAuth(c: Context): AuthUser {
  const user = getAuthenticatedUser(c)
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return user
}
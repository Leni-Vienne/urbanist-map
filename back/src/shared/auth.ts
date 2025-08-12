import * as jose from 'jose'
import { Context, Next } from 'hono'
import { TRPCError } from '@trpc/server'

// AI : JWT payload structure (Supabase format)
export interface SupabaseJWTPayload {
  sub: string // AI : User ID
  email?: string
  aud: string
  role: string
  iss: string
  iat?: number
  exp?: number
  user_metadata?: {
    username?: string
  }
}

// AI : Simplified user payload for our app
export interface JWTPayload {
  userId: string
  email?: string
  username?: string
  role?: string
}

// AI : Supabase JWT verification utilities
export class SupabaseJWTAuth {
  private jwtSecret: Uint8Array

  constructor(jwtSecret: string) {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters long')
    }
    this.jwtSecret = new TextEncoder().encode(jwtSecret)
  }

  // AI : Verify Supabase JWT token
  async verifySupabaseToken(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret)
      const supabasePayload = payload as SupabaseJWTPayload
      
      return {
        userId: supabasePayload.sub,
        email: supabasePayload.email,
        username: supabasePayload.user_metadata?.username,
        role: supabasePayload.role
      }
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        throw new Error('Token expired')
      } else if (error instanceof jose.errors.JWTInvalid) {
        throw new Error('Invalid token')
      }
      console.error('Error verifying Supabase JWT token:', error)
      throw new Error('Token verification failed')
    }
  }
}

// AI : Extract JWT token from Authorization header
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null
  
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  
  return parts[1]
}

// AI : Hono middleware for Supabase JWT authentication
export function createSupabaseJWTMiddleware(supabaseAuth: SupabaseJWTAuth) {
  return async (c: Context, next: Next) => {
    try {
      const authHeader = c.req.header('Authorization')
      const token = extractBearerToken(authHeader)
      
      if (!token) {
        c.set('user', null)
        return next()
      }

      const payload = await supabaseAuth.verifySupabaseToken(token)
      c.set('user', payload)
      
      return next()
    } catch (error) {
      console.error('Supabase JWT middleware error:', error)
      c.set('user', null)
      return next()
    }
  }
}

// AI : Helper to get authenticated user from Hono context
export function getAuthenticatedUser(c: Context): JWTPayload | null {
  return c.get('user') ?? null
}

// AI : Helper to require authentication
export function requireAuth(c: Context): JWTPayload {
  const user = getAuthenticatedUser(c)
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return user
}
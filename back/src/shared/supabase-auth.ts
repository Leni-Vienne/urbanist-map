import { Context, Next } from 'hono'

// AI : Simplified user payload for our app
export interface JWTPayload {
  userId: string
  email?: string
  username?: string
  role?: string
}

// AI : Extract JWT token from Authorization header
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null
  
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  
  return parts[1]
}

// AI : Verify Supabase JWT token by making a request to Supabase
async function verifySupabaseToken(token: string, supabaseUrl: string, supabaseAnonKey: string): Promise<JWTPayload | null> {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
      }
    })

    if (!response.ok) {
      return null
    }

    const userData = await response.json()
    
    return {
      userId: userData.id,
      email: userData.email,
      username: userData.user_metadata?.username || userData.email?.split('@')[0],
      role: userData.role || 'authenticated'
    }
  } catch (error) {
    console.error('Error verifying Supabase token:', error)
    return null
  }
}

// AI : Hono middleware for Supabase authentication
export function createSupabaseAuthMiddleware(supabaseUrl: string, supabaseAnonKey: string) {
  return async (c: Context, next: Next) => {
    try {
      const authHeader = c.req.header('Authorization')
      const token = extractBearerToken(authHeader)
      
      if (!token) {
        c.set('user', null)
        return next()
      }

      const user = await verifySupabaseToken(token, supabaseUrl, supabaseAnonKey)
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
export function getAuthenticatedUser(c: Context): JWTPayload | null {
  return c.get('user') ?? null
}

// AI : Helper to require authentication
export function requireAuth(c: Context): JWTPayload {
  const user = getAuthenticatedUser(c)
  if (!user) {
    throw new Error('Authentication required')
  }
  return user
}
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { trpc } from '../client'

// AI : User type for our custom authentication
interface User {
  id: string
  email: string
  username: string | null
  role: string | null
  emailVerified: boolean
}

// AI : Helper function to load Google Identity Services script
function loadGoogleIdentityScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    
    document.head.appendChild(script)
  })
}
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)

  // AI : Computed properties
  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  // AI : Initialize auth state
  async function initialize() {
    try {
      loading.value = true
      
      // AI : Try to get current user from server (will use session cookies)
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/check-session`, {
        credentials: 'include'
      })
      
      if (response.ok) {
        const result = await response.json() as { user: User }
        user.value = result.user
      } else {
        user.value = null
      }
    } catch (error) {
      console.error('Error initializing auth:', error)
      user.value = null
    } finally {
      loading.value = false
    }
  }

  // AI : Sign up with email and password
  async function signUp(email: string, password: string, username: string) {
    try {
      const result = await trpc.auth.register.mutate({
        email,
        password,
        username,
      })

      return {
        success: result.success,
        user: result.user,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Sign up error:', error)
      return { 
        success: false, 
        user: null, 
        error:  error instanceof Error ? error.message : 'Registration failed'
      }
    }
  }

  // AI : Sign in with email and password
  async function signIn(email: string, password: string) {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include'
      })

      const result = await response.json() as { success: boolean; user?: User; error?: string; message?: string }

      if (response.ok && result.success) {
        user.value = result.user ?? null
        // AI : Store last login method for UX hint
        if (result.user?.email) {
          localStorage.setItem(`lastLoginMethod:${result.user.email}`, 'email')
        }
        return {
          success: true,
          user: result.user ?? null,
          error: null
        }
      } else {
        return {
          success: false,
          user: null,
          error: result.error ?? result.message ?? 'Login failed'
        }
      }
    } catch (error: unknown) {
      console.error('Sign in error:', error)
      return {
        success: false,
        user: null,
        error: error instanceof Error ? error.message : 'Login failed'
      }
    }
  }

  // AI : Google OAuth authentication using simple One Tap
  async function signInWithOAuth(provider: 'google' | 'facebook'): Promise<{ success: boolean; user: User | null; error: string | null }> {
    try {
      if (provider !== 'google') {
        return { 
          success: false, 
          user: null,
          error: 'Only Google OAuth is currently supported' 
        }
      }

      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
      if (!clientId) {
        return { 
          success: false, 
          user: null,
          error: 'Google Client ID not configured' 
        }
      }

      // AI : Load Google Identity Services script if not already loaded
      if (!window.google) {
        await loadGoogleIdentityScript()
      }
      
      return await new Promise((resolve) => {
        if (!window.google) {
          resolve({
            success: false,
            user: null,
            error: 'Google Identity Services not loaded'
          })
          return
        }

        // AI : Set up timeout to handle cases where user doesn't interact
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            user: null,
            error: 'Google authentication timed out'
          })
        }, 60000) // 60 second timeout

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: { credential: string }) => {
            clearTimeout(timeout)

            try {
              // AI : Send the Google token to our backend
              const result = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/google-login`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token: response.credential }),
                credentials: 'include'
              })

              const data = await result.json() as { success: boolean; user?: User; error?: string }

              if (result.ok && data.success) {
                user.value = data.user ?? null
                // AI : Store last login method for UX hint
                if (data.user?.email) {
                  localStorage.setItem(`lastLoginMethod:${data.user.email}`, 'google')
                }
                resolve({
                  success: true,
                  user: data.user ?? null,
                  error: null
                })
              } else {
                resolve({
                  success: false,
                  user: null,
                  error: data.error ?? 'Google authentication failed'
                })
              }
            } catch (error: unknown) {
              console.error('Google OAuth error:', error)
              resolve({ 
                success: false, 
                user: null,
                error: error instanceof Error ? error.message : 'Google authentication failed'
              })
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true
        })

        window.google.accounts.id.prompt()
      })
    } catch (error: unknown) {
      console.error('Google OAuth initialization error:', error)
      return { 
        success: false, 
        user: null,
        error: error instanceof Error ? error.message : 'Google authentication not available'
      }
    }
  }

  // AI : Sign out
  async function signOut() {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/logout`, {
        method: 'POST',
        credentials: 'include'
      })

      user.value = null
      
      // AI : Clear all caches on logout (cities, projects, development projects)
      const { useMapStore } = await import('./pinia/mapStore')
      const { useProjectStore } = await import('./pinia/projectStore')
      const mapStore = useMapStore()
      const projectStore = useProjectStore()
      mapStore.clearCityProjectsCache()
      mapStore.clearCityDevelopmentProjectsCache()
      projectStore.clearCitiesCache()

      if (response.ok) {
        return { success: true, error: null }
      } else {
        const result = await response.json() as { error?: string }
        return { success: false, error: result.error ?? 'Logout failed' }
      }
    } catch (error: unknown) {
      console.error('Sign out error:', error)
      // AI : Clear local data even if server logout fails
      user.value = null
      return { success: false, error: error instanceof Error ? error.message : 'Logout failed' }
    }
  }

  // AI : Verify email
  async function verifyEmail(token: string) {
    try {
      const result = await trpc.auth.verifyEmail.mutate({ token })
      return {
        success: result.success,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Email verification error:', error)
      return {
        success: false,
        error:  error instanceof Error ? error.message : 'Email verification failed'
      }
    }
  }

  // AI : Request password reset
  async function requestPasswordReset(email: string) {
    try {
      const result = await trpc.auth.requestPasswordReset.mutate({ email })
      return {
        success: result.success,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Password reset request error:', error)
      return {
        success: false,
        error:  error instanceof Error ? error.message : 'Password reset request failed'
      }
    }
  }

  // AI : Reset password
  async function resetPassword(token: string, password: string) {
    try {
      const result = await trpc.auth.resetPassword.mutate({ token, password })
      return {
        success: result.success,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Password reset error:', error)
      return {
        success: false,
        error:  error instanceof Error ? error.message : 'Password reset failed'
      }
    }
  }

  // AI : Get authorization header for API calls (cookies are handled automatically)
  function getAuthHeader() {
    return null // AI : No need for auth headers with cookie-based auth
  }

  // AI : Get last login method for a given email (for UX hint)
  function getLastLoginMethod(email: string): 'email' | 'google' | null {
    try {
      const method = localStorage.getItem(`lastLoginMethod:${email}`)
      return method as 'email' | 'google' | null
    } catch {
      return null
    }
  }

  return {
    user,
    loading,
    isAuthenticated,
    isAdmin,
    initialize,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    getAuthHeader,
    getLastLoginMethod,
  }
})

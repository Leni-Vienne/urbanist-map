import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)

  // AI : Computed properties
  const isAuthenticated = computed(() => !!user.value)

  // AI : Initialize auth state
  async function initialize() {
    try {
      loading.value = true
      const { data: { session } } = await supabase.auth.getSession()
      user.value = session?.user ?? null
    } catch (error) {
      console.error('Error initializing auth:', error)
      user.value = null
    } finally {
      loading.value = false
    }
  }

  // AI : Sign up with email and password
  async function signUp(email: string, password: string, username?: string) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username ?? email.split('@')[0]
          }
        }
      })

      if (error) throw error

      // AI : User creation will be handled by backend/database triggers
      return { success: true, user: data.user, error: null }
    } catch (error: any) {
      console.error('Sign up error:', error)
      return { success: false, user: null, error: error.message }
    }
  }

  // AI : Sign in with email and password
  async function signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      user.value = data.user
      return { success: true, user: data.user, error: null }
    } catch (error: any) {
      console.error('Sign in error:', error)
      return { success: false, user: null, error: error.message }
    }
  }

  // AI : Sign in with OAuth provider (Google, GitHub, etc.)
  async function signInWithOAuth(provider: 'google' | 'github' | 'discord' | 'facebook') {
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) throw error

      return { success: true, error: null }
    } catch (error: any) {
      console.error('OAuth sign in error:', error)
      return { success: false, error: error.message }
    }
  }

  // AI : Sign out
  async function signOut() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error

      user.value = null
      return { success: true, error: null }
    } catch (error: any) {
      console.error('Sign out error:', error)
      return { success: false, error: error.message }
    }
  }

  // AI : Get current session
  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  // AI : Get access token for API calls
  async function getAccessToken() {
    const session = await getSession()
    return session?.access_token ?? null
  }

  // AI : Get authorization header for API calls
  async function getAuthHeader() {
    const token = await getAccessToken()
    return token ? `Bearer ${token}` : null
  }

  // AI : Setup auth state change listener
  supabase.auth.onAuthStateChange((event, session) => {
    user.value = session?.user ?? null
    
    if (event === 'SIGNED_IN') {
      console.log('User signed in:', session?.user?.email)
    } else if (event === 'SIGNED_OUT') {
      console.log('User signed out')
    }
  })

  return {
    user,
    loading,
    isAuthenticated,
    initialize,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    getSession,
    getAccessToken,
    getAuthHeader,
  }
})
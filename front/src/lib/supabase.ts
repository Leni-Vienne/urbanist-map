import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// AI : Create Supabase client for authentication and database operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// AI : Database types for better TypeScript support
export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          username: string
          email: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          username: string
          email: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          email?: string
          created_at?: string
          updated_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          name: string
          description: string | null
          owner_id: string | null
          metadata: any | null
          created_at: string
          updated_at: string
          city_id: string | null
          status: 'pending' | 'approved' | 'rejected'
          source_url: string | null
          start_date: string | null
          end_date: string | null
          latest_update_on: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          owner_id?: string | null
          metadata?: any | null
          created_at?: string
          updated_at?: string
          city_id?: string | null
          status?: 'pending' | 'approved' | 'rejected'
          source_url?: string | null
          start_date?: string | null
          end_date?: string | null
          latest_update_on?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          owner_id?: string | null
          metadata?: any | null
          created_at?: string
          updated_at?: string
          city_id?: string | null
          status?: 'pending' | 'approved' | 'rejected'
          source_url?: string | null
          start_date?: string | null
          end_date?: string | null
          latest_update_on?: string | null
        }
      }
    }
  }
}
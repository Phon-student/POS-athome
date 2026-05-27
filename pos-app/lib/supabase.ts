import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      products: {
        Row: Product
        Insert: Product
        Update: Partial<Product>
      }
      transactions: {
        Row: Transaction & { id: number; created_at: string }
        Insert: Omit<Transaction, 'id' | 'created_at'> & {
          id?: number
          created_at?: string
        }
        Update: Partial<Transaction>
      }
      cash_reports: {
        Row: CashReport & { id: number; created_at: string }
        Insert: CashReport & {
          id?: number
          created_at?: string
        }
        Update: Partial<CashReport>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

let supabaseClient: SupabaseClient<Database> | null = null

const SUPABASE_ENV_HINT =
  'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) in Vercel Environment Variables.'

function resolveSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL
  )
}

function resolveSupabaseKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
}

export function getSupabaseServerClient() {
  const supabaseUrl = resolveSupabaseUrl()
  const supabaseAnonKey = resolveSupabaseKey()

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  if (!supabaseClient) {
    supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey)
  }

  return supabaseClient
}

export function getSupabaseConfigErrorMessage() {
  return SUPABASE_ENV_HINT
}

export type Product = {
  id: string
  name: string
  price: number
  category: string
}

export type CartItem = {
  product: Product
  qty: number
}

export type Transaction = {
  id?: number
  created_at?: string
  booth_location: string
  payment_method: 'PromptPay' | 'Cash'
  subtotal: number
  discount: number
  total_amount: number
  items: Json
  metadata: Record<string, Json>
}

export type CashReport = {
  booth_location: string
  report_type: 'OPENING' | 'CLOSING'
  total_value: number
  denomination_breakdown: Record<string, number>
}

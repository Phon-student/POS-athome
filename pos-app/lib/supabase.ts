import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
  items: { id: string; qty: number; price_at_sale: number }[]
  metadata: Record<string, unknown>
}

export type CashReport = {
  booth_location: string
  report_type: 'OPENING' | 'CLOSING'
  total_value: number
  denomination_breakdown: Record<string, number>
}

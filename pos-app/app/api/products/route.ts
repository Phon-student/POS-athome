import { NextResponse } from 'next/server'
import { getSupabaseConfigErrorMessage, getSupabaseServerClient } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json([], {
      headers: {
        'x-pos-warning': getSupabaseConfigErrorMessage(),
      },
    })
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('category')

  if (error) {
    console.error('Failed to load products from Supabase:', error)
    return NextResponse.json([], {
      headers: {
        'x-pos-warning': `Supabase products query failed: ${error.message}`,
      },
    })
  }

  return NextResponse.json(data ?? [])
}

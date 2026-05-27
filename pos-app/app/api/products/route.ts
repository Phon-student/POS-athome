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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

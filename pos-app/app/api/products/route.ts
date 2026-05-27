import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.' },
      { status: 500 }
    )
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('category')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

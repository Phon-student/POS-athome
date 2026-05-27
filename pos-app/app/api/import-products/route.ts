import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.' },
      { status: 500 }
    )
  }

  const products = await req.json()
  // Upsert all products (insert or update by id)
  const { error } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: products.length })
}

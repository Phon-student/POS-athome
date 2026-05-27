import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const products = await req.json()
  // Upsert all products (insert or update by id)
  const { error } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: products.length })
}

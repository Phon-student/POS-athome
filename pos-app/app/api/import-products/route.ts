import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseConfigErrorMessage, getSupabaseServerClient } from '@/lib/supabase'
import type { Database } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: getSupabaseConfigErrorMessage() }, { status: 500 })
  }

  const { shop_id: shopId, products } = (await req.json()) as {
    shop_id?: string
    products?: Database['public']['Tables']['products']['Insert'][]
  }

  if (!shopId) {
    return NextResponse.json({ error: 'Missing required field: shop_id' }, { status: 400 })
  }

  if (!Array.isArray(products)) {
    return NextResponse.json({ error: 'Missing required field: products[]' }, { status: 400 })
  }

  const scopedProducts = products.map(product => ({
    ...product,
    shop_id: shopId,
  }))

  // Upsert all products (insert or update by id)
  const { error } = await supabase
    .from('products')
    .upsert(scopedProducts, { onConflict: 'shop_id,id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: scopedProducts.length })
}

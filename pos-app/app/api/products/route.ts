import { NextResponse } from 'next/server'
import { getSupabaseConfigErrorMessage, getSupabaseServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const shopId = searchParams.get('shop_id')
  if (!shopId) {
    return NextResponse.json([], {
      headers: {
        ...NO_STORE_HEADERS,
        'x-pos-warning': 'Missing required query param: shop_id',
      },
    })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json([], {
      headers: {
        ...NO_STORE_HEADERS,
        'x-pos-warning': getSupabaseConfigErrorMessage(),
      },
    })
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('shop_id', shopId)
    .order('category')

  if (error) {
    console.error('Failed to load products from Supabase:', error)
    return NextResponse.json([], {
      headers: {
        ...NO_STORE_HEADERS,
        'x-pos-warning': `Supabase products query failed: ${error.message}`,
      },
    })
  }

  return NextResponse.json(data ?? [], {
    headers: NO_STORE_HEADERS,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseConfigErrorMessage, getSupabaseServerClient } from '@/lib/supabase'
import type { Database } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: getSupabaseConfigErrorMessage() }, { status: 500 })
  }

  const body = (await req.json()) as Database['public']['Tables']['transactions']['Insert']

  const { data, error } = await supabase
    .from('transactions')
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function GET(req: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: getSupabaseConfigErrorMessage() }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const booth = searchParams.get('booth')
  const paymentMethod = searchParams.get('payment_method')
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!booth) {
    return NextResponse.json({ error: 'Missing required query param: booth' }, { status: 400 })
  }

  let query = supabase
    .from('transactions')
    .select('total_amount')
    .eq('booth_location', booth)

  if (paymentMethod === 'Cash' || paymentMethod === 'PromptPay') {
    query = query.eq('payment_method', paymentMethod)
  }

  if (start) {
    query = query.gte('created_at', start)
  }

  if (end) {
    query = query.lt('created_at', end)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totals = (data ?? []).reduce<{ total_amount: number; transaction_count: number }>(
    (summary, tx) => {
      summary.total_amount += tx.total_amount
      summary.transaction_count += 1
      return summary
    },
    { total_amount: 0, transaction_count: 0 }
  )

  return NextResponse.json(totals)
}

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

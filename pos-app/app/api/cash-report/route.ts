import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseConfigErrorMessage, getSupabaseServerClient } from '@/lib/supabase'
import type { Database } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: getSupabaseConfigErrorMessage() }, { status: 500 })
  }

  const body = (await req.json()) as Database['public']['Tables']['cash_reports']['Insert']

  const { data, error } = await supabase
    .from('cash_reports')
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// GET /api/cash-report?booth=Booth_A&type=CLOSING&last=true
export async function GET(req: NextRequest) {
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: getSupabaseConfigErrorMessage() }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const booth = searchParams.get('booth')
  if (!booth) {
    return NextResponse.json({ error: 'Missing required query param: booth' }, { status: 400 })
  }

  const typeParam = searchParams.get('type')
  const type: Database['public']['Tables']['cash_reports']['Row']['report_type'] =
    typeParam === 'OPENING' ? 'OPENING' : 'CLOSING'

  const { data, error } = await supabase
    .from('cash_reports')
    .select('*')
    .eq('booth_location', booth)
    .eq('report_type', type)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

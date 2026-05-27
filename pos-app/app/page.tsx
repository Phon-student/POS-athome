'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Database } from '@/lib/supabase'
import { Product, CartItem } from '@/lib/supabase'
import { calculateDiscount, calculateChange } from '@/lib/discount'
import {
  getBoothLocation,
  setBoothLocation,
  addOfflineSale,
  getOfflineSales,
  clearOfflineSales,
} from '@/lib/offline'

type PayStep = 'idle' | 'promptpay' | 'cash'
type Screen = 'pos' | 'float' | 'settings'
type FloatType = 'OPENING' | 'CLOSING'
type TransactionInsert = Database['public']['Tables']['transactions']['Insert']
type CashReportInsert = Database['public']['Tables']['cash_reports']['Insert']
type TransactionMetadata = TransactionInsert['metadata']
type ClosingSummary = {
  openingFloat: number | null
  cashSales: number
  expectedCash: number
  transactionCount: number
}

const DENOMS = [
  { label: '+20',   value: 20,   color: 'bg-green-100 text-green-800 border-green-300' },
  { label: '+50',   value: 50,   color: 'bg-blue-100 text-blue-800 border-blue-300' },
  { label: '+100',  value: 100,  color: 'bg-purple-100 text-purple-800 border-purple-300' },
  { label: '+500',  value: 500,  color: 'bg-orange-100 text-orange-800 border-orange-300' },
  { label: '+1000', value: 1000, color: 'bg-rose-100 text-rose-800 border-rose-300' },
]

const FLOAT_DENOMS = [
  { key: '1000s', label: '1,000฿', value: 1000 },
  { key: '500s',  label: '500฿',   value: 500  },
  { key: '100s',  label: '100฿',   value: 100  },
  { key: '50s',   label: '50฿',    value: 50   },
  { key: '20s',   label: '20฿',    value: 20   },
  { key: '10s',   label: '10฿',    value: 10   },
  { key: '5s',    label: '5฿',     value: 5    },
  { key: '1s',    label: '1฿',     value: 1    },
]

const LOCAL_PRODUCTS_KEY  = 'pos_products'
const LOCAL_PROMOS_KEY    = 'pos_promos'
const LOCAL_QR_KEY        = 'pos_qr_image'

type PromoConfig = {
  comboDiscount: number   // ฿ off per beverage+bakery pair
  bulkQty: number         // minimum qty to trigger bulk
  bulkDiscount: number    // ฿ off for bulk
}

const DEFAULT_PROMO: PromoConfig = { comboDiscount: 30, bulkQty: 3, bulkDiscount: 50 }

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.price === 'number' &&
    typeof candidate.category === 'string'
  )
}

function isProductArray(value: unknown): value is Product[] {
  return Array.isArray(value) && value.every(isProduct)
}

// ── Persistence helpers ───────────────────────────────────────
function loadLocalProducts(): Product[] | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) || 'null')
    return isProductArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
function saveLocalProducts(p: Product[]) {
  localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(p))
}
function loadLocalPromo(): PromoConfig {
  if (typeof window === 'undefined') return DEFAULT_PROMO
  try { return JSON.parse(localStorage.getItem(LOCAL_PROMOS_KEY) || 'null') || DEFAULT_PROMO } catch { return DEFAULT_PROMO }
}
function saveLocalPromo(p: PromoConfig) {
  localStorage.setItem(LOCAL_PROMOS_KEY, JSON.stringify(p))
}
function loadQR(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(LOCAL_QR_KEY) || ''
}
function saveQR(dataUrl: string) {
  localStorage.setItem(LOCAL_QR_KEY, dataUrl)
}

// ── Dynamic discount using promo config ──────────────────────
function calcDiscount(cart: CartItem[], promo: PromoConfig) {
  const subtotal = cart.reduce((s, i) => s + i.product.price * i.qty, 0)
  const totalQty = cart.reduce((s, i) => s + i.qty, 0)
  const bevQty   = cart.filter(i => i.product.category === 'beverage').reduce((s, i) => s + i.qty, 0)
  const bakQty   = cart.filter(i => i.product.category === 'bakery').reduce((s, i) => s + i.qty, 0)
  const combos = Math.min(bevQty, bakQty)
  const comboDiscount = combos * promo.comboDiscount
  const bulkDiscount  = totalQty >= promo.bulkQty ? promo.bulkDiscount : 0
  let discount = 0, discountLabel = ''
  if (comboDiscount > 0 || bulkDiscount > 0) {
    if (comboDiscount >= bulkDiscount) {
      discount = comboDiscount
      discountLabel = `${combos}× Combo (-฿${comboDiscount})`
    } else {
      discount = bulkDiscount
      discountLabel = `Bulk ${promo.bulkQty}+ items (-฿${bulkDiscount})`
    }
  }
  return { subtotal, discount, total: Math.max(0, subtotal - discount), discountLabel }
}

const LOCAL_SHEETS_URL_KEY = 'pos_sheets_url'

// ── Google Sheets helpers ────────────────────────────────────
// Convert any share/edit URL into a CSV export URL for a given gid (sheet tab)
function sheetsUrlToCsv(url: string, gid = '0'): string {
  // Extract the spreadsheet ID from common URL patterns
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('Could not extract spreadsheet ID from URL')
  const id = match[1]
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    // Simple CSV parse (handles quoted commas)
    const cols: string[] = []
    let cur = '', inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cols.push(cur.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (cols[i] || '').replace(/^"|"$/g, '') })
    return row
  })
}

function getLocalDayRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

async function fetchSheetsData(url: string): Promise<{ products: Product[]; promo: PromoConfig | null }> {
  // Sheet 1 (gid=0) — Products: id, name, price, category
  const csvUrl1 = sheetsUrlToCsv(url, '0')
  const res1 = await fetch(csvUrl1)
  if (!res1.ok) throw new Error('Could not fetch sheet. Make sure it is shared publicly (Anyone with link → Viewer).')
  const text1 = await res1.text()
  const rows1 = parseCSV(text1)
  const products: Product[] = rows1
    .filter(r => r['id'] && r['name'] && r['price'])
    .map(r => ({
      id:       r['id'].trim(),
      name:     r['name'].trim(),
      price:    parseFloat(r['price']),
      category: (r['category'] || 'beverage').trim().toLowerCase(),
    }))

  // Sheet 2 — Promo config (optional). gid must be found; we try common second-sheet gid patterns.
  // We embed the gid in the URL via a naming convention: user appends ?promoGid=XXXXX or we try gid=1
  let promo: PromoConfig | null = null
  try {
    // Try to extract a custom promoGid query param the user may have appended
    const urlObj = new URL(url.includes('?') ? url : url + '?')
    const promoGid = urlObj.searchParams.get('promoGid') || '1'
    const csvUrl2 = sheetsUrlToCsv(url, promoGid)
    const res2 = await fetch(csvUrl2)
    if (res2.ok) {
      const text2 = await res2.text()
      const rows2 = parseCSV(text2)
      if (rows2.length > 0) {
        const r = rows2[0]
        if (r['comboDiscount'] || r['bulkQty'] || r['bulkDiscount']) {
          promo = {
            comboDiscount: parseFloat(r['comboDiscount'] || String(DEFAULT_PROMO.comboDiscount)),
            bulkQty:       parseInt(r['bulkQty']        || String(DEFAULT_PROMO.bulkQty)),
            bulkDiscount:  parseFloat(r['bulkDiscount'] || String(DEFAULT_PROMO.bulkDiscount)),
          }
        }
      }
    }
  } catch { /* promo sheet is optional */ }

  return { products, promo }
}

// ─────────────────────────────────────────────────────────────
export default function POSPage() {
  const [products, setProducts]     = useState<Product[]>([])
  const [promo, setPromo]           = useState<PromoConfig>(DEFAULT_PROMO)
  const [qrImage, setQrImage]       = useState('')
  const [cart, setCart]             = useState<CartItem[]>([])
  const [payStep, setPayStep]       = useState<PayStep>('idle')
  const [cashIn, setCashIn]         = useState(0)
  const [booth, setBooth]           = useState('Booth_A')
  const [offlineCount, setOfflineCount] = useState(0)
  const [screen, setScreen]         = useState<Screen>('pos')
  const [floatType, setFloatType]   = useState<FloatType>('OPENING')
  const [floatDenoms, setFloatDenoms] = useState<Record<string, number>>({})
  const [closingSummary, setClosingSummary] = useState<ClosingSummary | null>(null)
  const [closingSummaryLoading, setClosingSummaryLoading] = useState(false)
  const [closingSummaryError, setClosingSummaryError] = useState('')
  const [toast, setToast]           = useState('')
  const [syncing, setSyncing]       = useState(false)
  const [importMsg, setImportMsg]   = useState('')
  const [importing, setImporting]   = useState(false)
  const [sheetsUrl, setSheetsUrl]   = useState('')
  const qrRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setBooth(getBoothLocation())
    setOfflineCount(getOfflineSales().length)
    setPromo(loadLocalPromo())
    setQrImage(loadQR())
    setSheetsUrl(localStorage.getItem(LOCAL_SHEETS_URL_KEY) || '')
    // Load products: localStorage first, then API
    const local = loadLocalProducts()
    if (local && local.length > 0) {
      setProducts(local)
    } else {
      fetch('/api/products')
        .then(async r => {
          const payload: unknown = await r.json().catch(() => null)
          if (!r.ok || !isProductArray(payload)) {
            throw new Error('Could not load products')
          }
          return payload
        })
        .then((data: Product[]) => {
          setProducts(data)
          saveLocalProducts(data)
        })
        .catch(() => {
          setProducts([])
          showToast('Could not load products. Import a menu or check the products API.')
        })
    }
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  const swapBooth = () => {
    const next = booth === 'Booth_A' ? 'Booth_B' : 'Booth_A'
    setBooth(next)
    setBoothLocation(next)
    showToast(`Switched to ${next}`)
  }

  // ── Cart ─────────────────────────────────────────────────
  const addToCart = (product: Product) => {
    setCart(prev => {
      const ex = prev.find(i => i.product.id === product.id)
      if (ex) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product, qty: 1 }]
    })
  }
  const removeFromCart = (id: string) => setCart(prev => prev.filter(i => i.product.id !== id))
  const updateQty = (id: string, qty: number) => {
    if (qty <= 0) { removeFromCart(id); return }
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, qty } : i))
  }
  const clearCart = () => { setCart([]); setPayStep('idle'); setCashIn(0) }

  const { subtotal, discount, total, discountLabel } = calcDiscount(cart, promo)
  const { change, breakdown } = calculateChange(total, cashIn)

  // ── Record sale ──────────────────────────────────────────
  const recordSale = useCallback(async (method: 'PromptPay' | 'Cash', meta: TransactionMetadata) => {
    const tx: TransactionInsert = {
      booth_location: booth,
      payment_method: method,
      subtotal, discount,
      total_amount: total,
      items: cart.map(i => ({ id: i.product.id, qty: i.qty, price_at_sale: i.product.price })),
      metadata: meta,
    }
    try {
      const res = await fetch('/api/record-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tx),
      })
      if (!res.ok) throw new Error()
      showToast('✓ Sale recorded!')
    } catch {
      addOfflineSale(tx)
      const count = getOfflineSales().length
      setOfflineCount(count)
      showToast(`⚠️ Saved offline (${count} pending)`)
    }
    clearCart()
  }, [booth, cart, subtotal, discount, total])

  // ── Sync offline ─────────────────────────────────────────
  const syncOffline = async () => {
    const offline = getOfflineSales()
    if (!offline.length) return
    setSyncing(true)
    let failed = 0
    for (const tx of offline) {
      try {
        const res = await fetch('/api/record-sale', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tx),
        })
        if (!res.ok) failed++
      } catch { failed++ }
    }
    if (failed === 0) { clearOfflineSales(); setOfflineCount(0); showToast(`✓ All ${offline.length} sales synced!`) }
    else showToast(`⚠️ ${failed} sales still failed`)
    setSyncing(false)
  }

  // ── Float ────────────────────────────────────────────────
  const floatTotal = FLOAT_DENOMS.reduce((s, d) => s + (floatDenoms[d.key] || 0) * d.value, 0)
  const variance = closingSummary ? floatTotal - closingSummary.expectedCash : null

  const loadClosingSummary = useCallback(async () => {
    setClosingSummaryLoading(true)
    setClosingSummaryError('')

    const { start, end } = getLocalDayRange()
    const boothQuery = encodeURIComponent(booth)
    const salesQuery = new URLSearchParams({
      booth,
      payment_method: 'Cash',
      start,
      end,
    })

    try {
      const [openingRes, salesRes] = await Promise.all([
        fetch(`/api/cash-report?booth=${boothQuery}&type=OPENING`),
        fetch(`/api/record-sale?${salesQuery.toString()}`),
      ])

      let openingFloat: number | null = null
      if (openingRes.ok) {
        const openingData = await openingRes.json()
        openingFloat = typeof openingData.total_value === 'number' ? openingData.total_value : null
      } else if (openingRes.status !== 404) {
        throw new Error('Could not load opening float')
      }

      if (!salesRes.ok) {
        throw new Error('Could not load cash sales summary')
      }

      const salesData = await salesRes.json() as { total_amount?: number; transaction_count?: number }
      const cashSales = typeof salesData.total_amount === 'number' ? salesData.total_amount : 0
      const transactionCount = typeof salesData.transaction_count === 'number' ? salesData.transaction_count : 0

      setClosingSummary({
        openingFloat,
        cashSales,
        expectedCash: cashSales + (openingFloat ?? 0),
        transactionCount,
      })
    } catch (error: unknown) {
      setClosingSummary(null)
      setClosingSummaryError(error instanceof Error ? error.message : 'Could not load closing summary')
    }

    setClosingSummaryLoading(false)
  }, [booth])
  const submitFloat = async () => {
    const report: CashReportInsert = {
      booth_location: booth,
      report_type: floatType,
      total_value: floatTotal,
      denomination_breakdown: floatDenoms,
    }
    try {
      const res = await fetch('/api/cash-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) })
      if (!res.ok) throw new Error()
      showToast(`✓ ${floatType} report saved — ฿${floatTotal}`)
      setFloatDenoms({})
      setScreen('pos')
    } catch { showToast('⚠️ Failed to save report') }
  }
  const autofillYesterday = async () => {
    try {
      const res = await fetch(`/api/cash-report?booth=${booth}&type=CLOSING`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setFloatDenoms(data.denomination_breakdown || {})
      showToast("✓ Loaded yesterday's closing count")
    } catch { showToast('No previous closing data found') }
  }

  useEffect(() => {
    if (screen !== 'float' || floatType !== 'CLOSING') return
    loadClosingSummary().catch(() => {})
  }, [floatType, loadClosingSummary, screen])

  // ── Import handlers ──────────────────────────────────────
  const handleSheetsImport = async () => {
    if (!sheetsUrl.trim()) { setImportMsg('⚠️ Paste a Google Sheets URL first'); return }
    setImporting(true)
    setImportMsg('Fetching…')
    try {
      localStorage.setItem(LOCAL_SHEETS_URL_KEY, sheetsUrl.trim())
      const { products: newProds, promo: newPromo } = await fetchSheetsData(sheetsUrl.trim())
      if (newProds.length === 0) { setImportMsg('⚠️ No products found. Check column headers: id, name, price, category'); setImporting(false); return }
      setProducts(newProds)
      saveLocalProducts(newProds)
      fetch('/api/import-products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProds),
      }).catch(() => {})
      if (newPromo) {
        setPromo(newPromo)
        saveLocalPromo(newPromo)
        setImportMsg(`✓ Imported ${newProds.length} products + promo config`)
      } else {
        setImportMsg(`✓ Imported ${newProds.length} products`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setImportMsg(`⚠️ ${msg}`)
    }
    setImporting(false)
  }

  const handleQR = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target!.result as string
      setQrImage(dataUrl)
      saveQR(dataUrl)
      showToast('✓ QR image saved')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const categoryOrder = ['beverage', 'bakery']
  const grouped = categoryOrder.map(cat => ({ cat, items: products.filter(p => p.category === cat) }))

  // ─────────────────────────────────────────────────────────
  // ── SETTINGS SCREEN ──────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  if (screen === 'settings') {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex flex-col">
        <header className="bg-[var(--ink)] text-white px-4 py-3 flex items-center gap-3">
          <button onClick={() => setScreen('pos')} className="text-white/60 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-white/20 tap-scale">← Back</button>
          <span className="font-display text-lg flex-1 text-center">Setup & Import</span>
          <div className="w-16" />
        </header>

        <div className="flex-1 overflow-y-auto p-4 max-w-lg mx-auto w-full space-y-6">

          {/* ── Import Products ─────────────── */}
          <section className="bg-white rounded-2xl border border-[var(--border)] p-5">
            <h3 className="font-display text-base mb-1">📊 Import from Google Sheets</h3>
            <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">
              Paste a public Google Sheets share link. The app fetches it directly — no file download needed.
            </p>

            {/* How-to steps */}
            <div className="bg-[var(--paper)] rounded-xl p-3 mb-4 text-xs border border-[var(--border)] space-y-2">
              <div className="font-semibold text-[var(--ink)] mb-1">Sheet setup</div>
              <div className="space-y-1 text-[var(--muted)]">
                <div><span className="text-[var(--ink)] font-semibold">Tab 1 — Products</span> (required columns):</div>
                <div className="font-mono bg-white rounded-lg px-2 py-1 border border-[var(--border)] grid grid-cols-4 gap-1">
                  <span className="text-[var(--accent)]">id</span>
                  <span className="text-[var(--accent)]">name</span>
                  <span className="text-[var(--accent)]">price</span>
                  <span className="text-[var(--accent)]">category</span>
                  <span>drink_01</span>
                  <span>Iced Latte</span>
                  <span>60</span>
                  <span>beverage</span>
                  <span>bake_01</span>
                  <span>Croissant</span>
                  <span>85</span>
                  <span>bakery</span>
                </div>
                <div className="mt-1"><span className="text-[var(--ink)] font-semibold">Tab 2 — Promo</span> (optional):</div>
                <div className="font-mono bg-white rounded-lg px-2 py-1 border border-[var(--border)] grid grid-cols-3 gap-1">
                  <span className="text-[var(--accent)]">comboDiscount</span>
                  <span className="text-[var(--accent)]">bulkQty</span>
                  <span className="text-[var(--accent)]">bulkDiscount</span>
                  <span>30</span><span>3</span><span>50</span>
                </div>
              </div>
              <div className="pt-1 border-t border-[var(--border)] text-[var(--muted)]">
                Share: <strong className="text-[var(--ink)]">File → Share → Anyone with link → Viewer</strong>
              </div>
              <div className="text-[var(--muted)]">
                If you have a 2nd Promo tab, append <span className="font-mono text-[var(--ink)] bg-white px-1 rounded">?promoGid=YOUR_GID</span> to the URL you paste below. Find the gid in the sheet's address bar after <span className="font-mono">#gid=</span>
              </div>
            </div>

            {/* URL input */}
            <div className="flex flex-col gap-2">
              <input
                type="url"
                value={sheetsUrl}
                onChange={e => setSheetsUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full text-xs px-3 py-3 rounded-xl border-2 border-[var(--border)] focus:border-[var(--accent)] outline-none font-mono bg-[var(--paper)]"
              />
              <button
                onClick={handleSheetsImport}
                disabled={importing || !sheetsUrl.trim()}
                className="w-full py-3 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold tap-scale disabled:opacity-40 transition-opacity"
              >
                {importing ? '⏳ Fetching…' : '⬇️ Fetch & Import'}
              </button>
            </div>

            {importMsg && (
              <p className={`mt-2 text-xs text-center font-semibold ${importMsg.startsWith('✓') ? 'text-[var(--success)]' : 'text-amber-600'}`}>
                {importMsg}
              </p>
            )}

            {/* Current products list */}
            {products.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">Current Menu ({products.length} items)</div>
                <div className="space-y-1">
                  {products.map(p => (
                    <div key={p.id} className="flex justify-between text-xs bg-[var(--paper)] rounded-lg px-3 py-1.5">
                      <span className="font-semibold">{p.name}</span>
                      <span className="flex gap-3 text-[var(--muted)]">
                        <span className="capitalize">{p.category}</span>
                        <span className="text-[var(--accent)] font-bold">฿{p.price}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Active Promo Config ─────────── */}
          <section className="bg-white rounded-2xl border border-[var(--border)] p-5">
            <h3 className="font-display text-base mb-3">🏷️ Active Promo Rules</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Combo discount</div>
                  <div className="text-xs text-[var(--muted)]">฿ off per beverage+bakery pair</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { const v = { ...promo, comboDiscount: Math.max(0, promo.comboDiscount - 5) }; setPromo(v); saveLocalPromo(v) }} className="w-8 h-8 rounded-lg bg-[var(--border)] font-bold tap-scale">−</button>
                  <span className="w-10 text-center font-display font-bold">฿{promo.comboDiscount}</span>
                  <button onClick={() => { const v = { ...promo, comboDiscount: promo.comboDiscount + 5 }; setPromo(v); saveLocalPromo(v) }} className="w-8 h-8 rounded-lg bg-[var(--ink)] text-white font-bold tap-scale">+</button>
                </div>
              </div>
              <div className="h-px bg-[var(--border)]" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Bulk qty trigger</div>
                  <div className="text-xs text-[var(--muted)]">Minimum items in cart</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { const v = { ...promo, bulkQty: Math.max(2, promo.bulkQty - 1) }; setPromo(v); saveLocalPromo(v) }} className="w-8 h-8 rounded-lg bg-[var(--border)] font-bold tap-scale">−</button>
                  <span className="w-10 text-center font-display font-bold">{promo.bulkQty}</span>
                  <button onClick={() => { const v = { ...promo, bulkQty: promo.bulkQty + 1 }; setPromo(v); saveLocalPromo(v) }} className="w-8 h-8 rounded-lg bg-[var(--ink)] text-white font-bold tap-scale">+</button>
                </div>
              </div>
              <div className="h-px bg-[var(--border)]" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Bulk discount</div>
                  <div className="text-xs text-[var(--muted)]">฿ off when bulk triggered</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { const v = { ...promo, bulkDiscount: Math.max(0, promo.bulkDiscount - 5) }; setPromo(v); saveLocalPromo(v) }} className="w-8 h-8 rounded-lg bg-[var(--border)] font-bold tap-scale">−</button>
                  <span className="w-10 text-center font-display font-bold">฿{promo.bulkDiscount}</span>
                  <button onClick={() => { const v = { ...promo, bulkDiscount: promo.bulkDiscount + 5 }; setPromo(v); saveLocalPromo(v) }} className="w-8 h-8 rounded-lg bg-[var(--ink)] text-white font-bold tap-scale">+</button>
                </div>
              </div>
            </div>
          </section>

          {/* ── QR Image ────────────────────── */}
          <section className="bg-white rounded-2xl border border-[var(--border)] p-5">
            <h3 className="font-display text-base mb-1">📲 PromptPay QR Image</h3>
            <p className="text-xs text-[var(--muted)] mb-4">This image is shown fullscreen when the customer pays via PromptPay.</p>
            {qrImage && (
              <div className="mb-4 flex justify-center">
                <img src={qrImage} alt="QR preview" className="w-36 h-36 object-contain rounded-xl border border-[var(--border)]" />
              </div>
            )}
            <input ref={qrRef} type="file" accept="image/*" className="hidden" onChange={handleQR} />
            <button
              onClick={() => qrRef.current?.click()}
              className="w-full py-3 rounded-xl border-2 border-dashed border-[var(--success)] text-[var(--success)] text-sm font-semibold tap-scale hover:bg-[var(--success-light)] transition-colors"
            >
              {qrImage ? '🔄 Replace QR image' : '📷 Upload QR image'}
            </button>
          </section>

        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ink)] text-white px-5 py-3 rounded-2xl text-sm font-semibold slide-up shadow-xl z-50">
            {toast}
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // ── FLOAT SCREEN ─────────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  if (screen === 'float') {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex flex-col">
        <header className="bg-[var(--ink)] text-white px-4 py-3 flex items-center gap-3">
          <button onClick={() => setScreen('pos')} className="text-white/60 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-white/20 tap-scale">← Back</button>
          <span className="font-display text-lg flex-1 text-center">{booth}</span>
          <div className="w-16" />
        </header>

        <div className="flex-1 overflow-y-auto p-4 max-w-md mx-auto w-full">
          <h2 className="font-display text-2xl mb-1">Cash Float</h2>
          <p className="text-[var(--muted)] text-sm mb-4">Count each denomination and enter quantities</p>

          <div className="flex gap-2 mb-5 bg-[var(--border)] p-1 rounded-xl">
            {(['OPENING', 'CLOSING'] as FloatType[]).map(t => (
              <button key={t} onClick={() => setFloatType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold tap-scale transition-all ${floatType === t ? 'bg-white shadow text-[var(--ink)]' : 'text-[var(--muted)]'}`}>
                {t === 'OPENING' ? '🌅 Opening' : '🌙 Closing'}
              </button>
            ))}
          </div>

          {floatType === 'OPENING' && (
            <button onClick={autofillYesterday}
              className="w-full mb-4 py-3 rounded-xl border-2 border-dashed border-[var(--accent)] text-[var(--accent)] text-sm font-semibold tap-scale hover:bg-[var(--accent-light)] transition-colors">
              📋 Autofill from Yesterday's Closing Count
            </button>
          )}

          {floatType === 'CLOSING' && (
            <div className="mb-4 rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg">End-of-Day Check</h3>
                  <p className="text-xs text-[var(--muted)]">Expected cash from today's opening float and cash sales</p>
                </div>
                <button onClick={() => loadClosingSummary().catch(() => {})}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs font-semibold tap-scale">
                  Refresh
                </button>
              </div>

              {closingSummaryLoading && (
                <div className="text-sm text-[var(--muted)]">Loading closing summary…</div>
              )}

              {!closingSummaryLoading && closingSummaryError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {closingSummaryError}
                </div>
              )}

              {!closingSummaryLoading && closingSummary && (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-[var(--paper)] px-3 py-2">
                      <div className="text-[var(--muted)] text-xs mb-1">Opening Float</div>
                      <div className="font-display text-xl">฿{(closingSummary.openingFloat ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl bg-[var(--paper)] px-3 py-2">
                      <div className="text-[var(--muted)] text-xs mb-1">Cash Sales Today</div>
                      <div className="font-display text-xl">฿{closingSummary.cashSales.toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl bg-[var(--paper)] px-3 py-2">
                      <div className="text-[var(--muted)] text-xs mb-1">Expected Cash</div>
                      <div className="font-display text-xl">฿{closingSummary.expectedCash.toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl bg-[var(--paper)] px-3 py-2">
                      <div className="text-[var(--muted)] text-xs mb-1">Cash Transactions</div>
                      <div className="font-display text-xl">{closingSummary.transactionCount}</div>
                    </div>
                  </div>

                  <div className={`rounded-xl px-4 py-3 border ${
                    variance === null
                      ? 'border-[var(--border)] bg-[var(--paper)]'
                      : variance === 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : variance > 0
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-red-200 bg-red-50 text-red-700'
                  }`}>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1">Variance</div>
                    <div className="font-display text-2xl">
                      {variance === null
                        ? '—'
                        : `${variance > 0 ? '+' : ''}฿${Math.abs(variance).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    </div>
                    <div className="text-xs mt-1">
                      Counted cash of ฿{floatTotal.toLocaleString()} against expected cash of ฿{closingSummary.expectedCash.toLocaleString()}
                    </div>
                  </div>

                  {closingSummary.openingFloat === null && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      No opening float report found for this booth today. Expected cash currently excludes opening float.
                    </div>
                  )}

                  {offlineCount > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      {offlineCount} offline sale{offlineCount === 1 ? '' : 's'} pending sync. Expected cash may be understated until they are synced.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-3 mb-6">
            {FLOAT_DENOMS.map(d => (
              <div key={d.key} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-[var(--border)]">
                <span className="font-display text-sm w-16">{d.label}</span>
                <div className="flex-1 flex items-center gap-2">
                  <button onClick={() => setFloatDenoms(prev => ({ ...prev, [d.key]: Math.max(0, (prev[d.key] || 0) - 1) }))}
                    className="w-9 h-9 rounded-lg bg-[var(--border)] font-bold text-lg tap-scale">−</button>
                  <span className="flex-1 text-center font-semibold text-lg">{floatDenoms[d.key] || 0}</span>
                  <button onClick={() => setFloatDenoms(prev => ({ ...prev, [d.key]: (prev[d.key] || 0) + 1 }))}
                    className="w-9 h-9 rounded-lg bg-[var(--ink)] text-white font-bold text-lg tap-scale">+</button>
                </div>
                <span className="text-[var(--muted)] text-sm w-20 text-right">= ฿{((floatDenoms[d.key] || 0) * d.value).toLocaleString()}</span>
              </div>
            ))}
          </div>

          <div className="bg-[var(--ink)] text-white rounded-2xl p-5 mb-4 flex items-center justify-between">
            <span className="font-display text-sm">TOTAL FLOAT</span>
            <span className="font-display text-3xl">฿{floatTotal.toLocaleString()}</span>
          </div>
          <button onClick={submitFloat} disabled={floatTotal === 0}
            className="w-full py-4 rounded-2xl bg-[var(--accent)] text-white font-display text-lg tap-scale disabled:opacity-40">
            Submit {floatType} Report
          </button>
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ink)] text-white px-5 py-3 rounded-2xl text-sm font-semibold slide-up shadow-xl z-50">
            {toast}
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // ── MAIN POS SCREEN ───────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--paper)] flex flex-col">

      {/* ── HEADER ── */}
      <header className="bg-[var(--ink)] text-white px-3 py-2.5 flex items-center gap-2 shrink-0">
        <button onClick={swapBooth}
          className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-3 py-1.5 text-sm font-semibold tap-scale">
          🔄 <span className="font-display">{booth}</span>
        </button>

        <div className="flex-1 text-center font-display text-sm tracking-wide opacity-60">BOOTH POS</div>

        <div className="flex gap-2">
          {offlineCount > 0 && (
            <button onClick={syncOffline} disabled={syncing}
              className="flex items-center gap-1 bg-amber-500 text-white rounded-lg px-3 py-1.5 text-xs font-bold tap-scale">
              <span className="pulse-dot">●</span>
              {syncing ? 'Syncing…' : `${offlineCount} Offline`}
            </button>
          )}
          <button onClick={() => setScreen('float')} className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs font-semibold tap-scale hover:bg-white/20">💰 Float</button>
          <button onClick={() => setScreen('settings')} className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs font-semibold tap-scale hover:bg-white/20">⚙️</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Product Grid ── */}
        <div className="flex-1 overflow-y-auto p-3">
          {products.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-[var(--muted)] py-12">
              <span className="text-4xl">📂</span>
              <p className="text-sm">No menu loaded.<br/>Tap <strong>⚙️</strong> to import your products.</p>
            </div>
          )}
          {grouped.map(({ cat, items }) => items.length > 0 && (
            <div key={cat} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
                  {cat === 'beverage' ? '☕ Drinks' : '🥐 Bakery'}
                </span>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {items.map(p => {
                  const inCart = cart.find(i => i.product.id === p.id)
                  return (
                    <button key={p.id} onClick={() => addToCart(p)}
                      className={`relative flex flex-col items-start p-3 rounded-2xl border-2 tap-scale transition-all text-left ${
                        inCart ? 'bg-[var(--accent-light)] border-[var(--accent)]' : 'bg-white border-[var(--border)] hover:border-[var(--accent)]'
                      }`}>
                      {inCart && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center">
                          {inCart.qty}
                        </span>
                      )}
                      <span className="font-semibold text-sm leading-tight mb-1 pr-6">{p.name}</span>
                      <span className="font-display text-lg text-[var(--accent)]">฿{p.price}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── RIGHT: Cart Panel ── */}
        <div className="w-[200px] md:w-[260px] bg-white border-l border-[var(--border)] flex flex-col">
          <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
            <span className="font-display text-sm">ORDER</span>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-[var(--muted)] hover:text-red-500 tap-scale">Clear</button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
            {cart.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-[var(--muted)] text-xs py-8 gap-1">
                <span className="text-3xl">🛒</span>
                <span>Tap products<br />to add</span>
              </div>
            )}
            {cart.map(item => (
              <div key={item.product.id} className="flex items-center gap-1.5 bg-[var(--paper)] rounded-xl p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{item.product.name}</div>
                  <div className="text-xs text-[var(--muted)]">฿{item.product.price}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(item.product.id, item.qty - 1)}
                    className="w-6 h-6 rounded-md bg-white border border-[var(--border)] text-sm font-bold flex items-center justify-center tap-scale">−</button>
                  <span className="text-sm font-bold w-4 text-center">{item.qty}</span>
                  <button onClick={() => updateQty(item.product.id, item.qty + 1)}
                    className="w-6 h-6 rounded-md bg-[var(--ink)] text-white text-sm font-bold flex items-center justify-center tap-scale">+</button>
                </div>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <div className="border-t border-[var(--border)] px-3 py-2 space-y-1">
              <div className="flex justify-between text-xs text-[var(--muted)]">
                <span>Subtotal</span><span>฿{subtotal}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-xs text-[var(--success)] font-semibold">
                  <span className="truncate pr-1">{discountLabel}</span>
                  <span>-฿{discount}</span>
                </div>
              )}
              <div className="flex justify-between font-display text-lg pt-1">
                <span>TOTAL</span><span className="text-[var(--accent)]">฿{total}</span>
              </div>
            </div>
          )}

          {/* Payment buttons */}
          {cart.length > 0 && payStep === 'idle' && (
            <div className="px-2 pb-3 pt-1 space-y-2">
              <button onClick={() => setPayStep('promptpay')}
                className="w-full py-3 rounded-xl bg-[var(--success)] text-white font-display text-sm tap-scale">
                📱 PromptPay
              </button>
              <button onClick={() => setPayStep('cash')}
                className="w-full py-3 rounded-xl bg-[var(--ink)] text-white font-display text-sm tap-scale">
                💵 Cash
              </button>
            </div>
          )}

          {/* ── PROMPTPAY FLOW ── */}
          {payStep === 'promptpay' && (
            <div className="flex flex-col slide-up">
              {/* Full QR image */}
              <div className="px-3 pt-2">
                {qrImage ? (
                  <img src={qrImage} alt="PromptPay QR" className="w-full rounded-2xl object-contain border border-[var(--border)]" style={{ maxHeight: 200 }} />
                ) : (
                  <div className="w-full rounded-2xl bg-[var(--paper)] border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center py-6 text-center gap-1">
                    <span className="text-2xl">📷</span>
                    <span className="text-xs text-[var(--muted)]">No QR uploaded yet.<br/>Go to ⚙️ Setup to add it.</span>
                  </div>
                )}
              </div>
              {/* Amount */}
              <div className="px-3 py-3 text-center">
                <div className="text-xs text-[var(--muted)] uppercase tracking-wider mb-0.5">Amount to transfer</div>
                <div className="font-display text-5xl font-black text-emerald-600">฿{total}</div>
              </div>
              <div className="px-2 pb-3 space-y-2">
                <button onClick={() => recordSale('PromptPay', {})}
                  className="w-full py-3 rounded-xl bg-[var(--success)] text-white font-display text-sm tap-scale">
                  ✓ Payment Received
                </button>
                <button onClick={() => setPayStep('idle')}
                  className="w-full py-1.5 rounded-xl text-[var(--muted)] text-xs tap-scale">
                  ← Back
                </button>
              </div>
            </div>
          )}

          {/* ── CASH FLOW ── */}
          {payStep === 'cash' && (
            <div className="px-2 pb-3 pt-1 space-y-2 slide-up">
              <div className="text-xs text-[var(--muted)] font-semibold uppercase tracking-wider text-center">Cash Received</div>
              <div className="grid grid-cols-3 gap-1.5">
                {DENOMS.map(d => (
                  <button key={d.value} onClick={() => setCashIn(p => p + d.value)}
                    className={`py-2.5 rounded-xl border text-xs font-bold tap-scale ${d.color}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-sm bg-[var(--paper)] rounded-xl px-3 py-2">
                <span className="text-[var(--muted)]">Received</span>
                <span className="font-semibold">฿{cashIn}</span>
              </div>
              {cashIn >= total && (
                <div className="bg-[var(--success-light)] rounded-xl px-3 py-2 border border-emerald-200">
                  <div className="text-xs text-[var(--success)] font-semibold mb-1">Change: ฿{change}</div>
                  {breakdown.map(b => (
                    <div key={b.denom} className="text-xs text-[var(--ink)]">
                      {b.count}× {b.denom}฿ {b.denom >= 20 ? 'note' : 'coin'}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <button onClick={() => setCashIn(0)} className="flex-1 py-2 rounded-xl bg-[var(--border)] text-[var(--ink)] text-xs font-semibold tap-scale">Reset</button>
                <button disabled={cashIn < total} onClick={() => recordSale('Cash', { cash_received: cashIn, change_returned: change })}
                  className="flex-1 py-2 rounded-xl bg-[var(--ink)] text-white text-xs font-semibold tap-scale disabled:opacity-40">
                  ✓ Done
                </button>
              </div>
              <button onClick={() => { setPayStep('idle'); setCashIn(0) }}
                className="w-full py-1.5 text-[var(--muted)] text-xs tap-scale">
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--ink)] text-white px-5 py-3 rounded-2xl text-sm font-semibold slide-up shadow-xl z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}

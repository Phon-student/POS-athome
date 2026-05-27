import { Transaction, CashReport } from './supabase'

const OFFLINE_SALES_KEY = 'pos_offline_sales'
const BOOTH_KEY = 'pos_booth_location'

export function getBoothLocation(): string {
  if (typeof window === 'undefined') return 'Booth_A'
  return localStorage.getItem(BOOTH_KEY) || 'Booth_A'
}

export function setBoothLocation(booth: string) {
  localStorage.setItem(BOOTH_KEY, booth)
}

export function getOfflineSales(): Transaction[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_SALES_KEY) || '[]')
  } catch {
    return []
  }
}

export function addOfflineSale(tx: Transaction) {
  const existing = getOfflineSales()
  existing.push({ ...tx, id: Date.now() })
  localStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(existing))
}

export function clearOfflineSales() {
  localStorage.removeItem(OFFLINE_SALES_KEY)
}

export function offlineSalesCount(): number {
  return getOfflineSales().length
}

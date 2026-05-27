import { Transaction, CashReport } from './supabase'

const OFFLINE_SALES_KEY = 'pos_offline_sales'
const BOOTH_KEY = 'pos_booth_location'
const STAFF_NAME_KEY = 'pos_staff_name'
const ADMIN_PIN_KEY = 'pos_admin_pin'

export function getStoredBoothLocation(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(BOOTH_KEY)
}

export function getBoothLocation(): string {
  if (typeof window === 'undefined') return 'Booth_A'
  return localStorage.getItem(BOOTH_KEY) || 'Booth_A'
}

export function setBoothLocation(booth: string) {
  localStorage.setItem(BOOTH_KEY, booth)
}

export function clearBoothLocation() {
  localStorage.removeItem(BOOTH_KEY)
}

export function getStaffName(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(STAFF_NAME_KEY) || ''
}

export function setStaffName(name: string) {
  localStorage.setItem(STAFF_NAME_KEY, name)
}

export function clearStaffSession() {
  localStorage.removeItem(STAFF_NAME_KEY)
}

export function getAdminPin(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(ADMIN_PIN_KEY) || ''
}

export function hasAdminPin(): boolean {
  return getAdminPin().length > 0
}

export function setAdminPin(pin: string) {
  localStorage.setItem(ADMIN_PIN_KEY, pin)
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

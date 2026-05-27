import { CartItem } from './supabase'

export type DiscountResult = {
  subtotal: number
  discount: number
  total: number
  discountLabel: string
}

export function calculateDiscount(cart: CartItem[]): DiscountResult {
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.qty, 0)
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0)

  // Count beverages and bakery items
  const beverageQty = cart
    .filter(i => i.product.category === 'beverage')
    .reduce((s, i) => s + i.qty, 0)
  const bakeryQty = cart
    .filter(i => i.product.category === 'bakery')
    .reduce((s, i) => s + i.qty, 0)

  const combos = Math.min(beverageQty, bakeryQty)
  const comboDiscount = combos * 30
  const bulkDiscount = totalQty >= 3 ? 50 : 0

  // Pick whichever is larger
  let discount = 0
  let discountLabel = ''

  if (comboDiscount > 0 || bulkDiscount > 0) {
    if (comboDiscount >= bulkDiscount) {
      discount = comboDiscount
      discountLabel = `${combos}x Combo Set (-฿${comboDiscount})`
    } else {
      discount = bulkDiscount
      discountLabel = `Bulk 3+ Items (-฿${bulkDiscount})`
    }
  }

  return {
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount),
    discountLabel,
  }
}

export function calculateChange(
  total: number,
  cashReceived: number
): { change: number; breakdown: { denom: number; count: number }[] } {
  const change = cashReceived - total
  if (change <= 0) return { change: 0, breakdown: [] }

  const denominations = [1000, 500, 100, 50, 20, 10, 5, 2, 1]
  const breakdown: { denom: number; count: number }[] = []
  let remaining = Math.round(change)

  for (const denom of denominations) {
    const count = Math.floor(remaining / denom)
    if (count > 0) {
      breakdown.push({ denom, count })
      remaining -= count * denom
    }
  }

  return { change, breakdown }
}

# 🏪 Booth POS

A lightweight, two-booth point-of-sale system built with **Next.js + Tailwind CSS + Supabase**, deployable to Vercel for free.

---

## ✅ Features

- 🔄 **Booth switcher** — toggle between `Booth_A` and `Booth_B` with one tap
- 🏷️ **Auto-discount engine** — combo sets (beverage + bakery = -฿30) or bulk 3+ items (-฿50)
- 📱 **PromptPay flow** — shows large transfer amount for manual QR scan
- 💵 **Cash assistant** — denomination tap buttons + exact change breakdown
- 📴 **Offline mode** — saves to localStorage when network drops, auto-syncs when back
- 💰 **Float reports** — opening & closing cash counts with autofill from previous close

---

## 🚀 Deploy in 3 Steps

### Step 1 — Set up Supabase

1. Go to [supabase.com](https://supabase.com) → Create a new project (free tier)
2. Open **SQL Editor** and run this script:

```sql
-- Products
CREATE TABLE public.products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    category TEXT NOT NULL
);

-- Cash float reports
CREATE TABLE public.cash_reports (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    booth_location TEXT NOT NULL,
    report_type TEXT NOT NULL,
    total_value NUMERIC NOT NULL,
    denomination_breakdown JSONB NOT NULL,
    CONSTRAINT check_report_type CHECK (report_type IN ('OPENING', 'CLOSING'))
);

-- Transactions
CREATE TABLE public.transactions (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    booth_location TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    subtotal NUMERIC NOT NULL,
    discount NUMERIC DEFAULT 0,
    total_amount NUMERIC NOT NULL,
    items JSONB NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT check_payment_method CHECK (payment_method IN ('PromptPay', 'Cash'))
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;

-- Seed products (edit these to match your actual menu!)
INSERT INTO public.products (id, name, price, category) VALUES
('drink_01', 'Iced Latte', 60.00, 'beverage'),
('drink_02', 'Matcha Latte', 70.00, 'beverage'),
('bakery_01', 'Almond Croissant', 85.00, 'bakery'),
('bakery_02', 'Chocolate Brownie', 50.00, 'bakery');
```

3. Go to **Settings → API** and copy:
   - `Project URL`
   - `anon public` key

### Step 2 — Deploy to Vercel

1. Push this folder to a **GitHub repo**
2. Go to [vercel.com](https://vercel.com) → Import the repo
3. In **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...your anon key` |

4. Click **Deploy** — done! 🎉

### Step 3 — Local Dev (optional)

```bash
cp .env.example .env.local
# Fill in your Supabase credentials

npm install
npm run dev
# Open http://localhost:3000
```

---

## 📋 Event Day Operations

### Morning: Opening Float
1. Open the app on each tablet → tap **💰 Float**
2. Select **🌅 Opening**, count all bills, tap +/− to enter quantities
3. On Day 2: tap **📋 Autofill from Yesterday's Closing Count** to pre-fill
4. Submit — baseline is recorded in Supabase

### During Event: Taking Orders
1. Tap product buttons to add to cart
2. Discounts apply automatically (shown in cart)
3. Choose **📱 PromptPay** or **💵 Cash**
4. For PromptPay: show customer the big green amount → verify slip → tap **✓ Slip Verified**
5. For Cash: tap denomination buttons → read change breakdown → tap **✓ Done**

### Network Drops
- A **🟡 X Offline** badge appears in the header
- Tap it when signal returns to sync all pending sales to Supabase

### Evening: Closing Float
1. Tap **💰 Float** → select **🌙 Closing**
2. Count all cash in the pouch and enter it
3. Submit — compare to Supabase dashboard to verify it matches expected cash

---

## 🛠️ Customising Your Menu

Edit the SQL `INSERT` statement in Step 1 to add your actual products. Categories must be `beverage` or `bakery` for the combo discount to work. You can add more items any time via the Supabase table editor.

---

## 📊 Viewing Sales Data

In your Supabase dashboard → **Table Editor** → `transactions` table. You can filter by `booth_location` to see each booth's sales separately.

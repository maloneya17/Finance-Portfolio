# Infinity Finance

A modern personal finance tracker built with Next.js 15, Supabase, and Stripe. Freemium model with a polished iOS-inspired design.

## Features

**Free Tier**
- Transaction tracking (income, expenses, transfers) with splits and tags
- Monthly budgets per category with progress bars
- Bill tracking with due dates and mark-paid
- Net worth overview (assets & debts)
- Interactive reports (bar, pie, line charts)
- Basic financial insights
- 3 months history, 1 device

**Pro (£4.99/mo)**
- Unlimited transaction history
- Multi-device sync
- Advanced AI-powered insights
- CSV/JSON export
- Recurring charge detection, FIRE projections
- Priority support

## Tech Stack

- **Framework**: Next.js 15 (App Router, Server Components)
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **State**: Zustand (hydrated from server data)
- **Charts**: Recharts
- **UI**: shadcn/ui pattern (Radix + Tailwind v4 + CVA)
- **Payments**: Stripe (Checkout, Customer Portal, Webhooks)
- **Auth**: Supabase Auth (Email/Password + Google OAuth)

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account

### 1. Clone and install

```bash
git clone <repo-url>
cd infinity-finance
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the schema in the SQL Editor:
   - Copy contents of `supabase/schema.sql` into the SQL Editor and execute
3. Enable Google OAuth (optional):
   - Go to Authentication > Providers > Google
   - Add your Google OAuth credentials

### 3. Set up Stripe

1. Create a product with a monthly price (£4.99) in the Stripe Dashboard
2. Copy the Price ID
3. Set up a webhook endpoint pointing to `https://your-domain.com/api/stripe/webhook`
4. Subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

### 4. Environment variables

Create `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

1. Push to GitHub
2. Import into [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local`
4. Update `NEXT_PUBLIC_APP_URL` to your production domain
5. Update the Stripe webhook URL to your production domain
6. Deploy

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login & signup pages
│   ├── (dashboard)/      # Protected pages (dashboard, transactions, etc.)
│   └── api/stripe/       # Stripe checkout, portal, webhook routes
├── components/
│   ├── ui/               # Reusable primitives (button, card, dialog, etc.)
│   ├── layout/           # App shell with sidebar navigation
│   ├── auth/             # Login & signup forms
│   ├── dashboard/        # Dashboard widgets (KPIs, charts, lists)
│   ├── transactions/     # Transaction CRUD
│   ├── bills/            # Bill management
│   ├── wealth/           # Assets, debts, goals
│   ├── reports/          # Charts and analytics
│   ├── insights/         # Smart financial insights
│   └── settings/         # User settings, billing, account
├── lib/
│   ├── supabase/         # Client, server, middleware helpers
│   └── utils.ts          # Shared utilities
├── store/
│   └── finance.ts        # Zustand store
└── types/
    └── supabase.ts       # Database types
```

## Database

Full schema with Row Level Security in `supabase/schema.sql`. Tables:

- `profiles` — User profile, subscription status, Stripe IDs
- `settings` — Currency, income, custom categories
- `transactions` — Income/expense/transfer with splits and tags
- `bills` — Recurring bills with due dates
- `bill_payments` — Payment records for bills
- `recurring_templates` — Auto-generate transactions
- `assets` — Assets for net worth tracking
- `debts` — Debts/liabilities
- `goals` — Savings goals with progress
- `budgets` — Monthly category budgets
- `wealth_snapshots` — Historical net worth snapshots

## License

MIT

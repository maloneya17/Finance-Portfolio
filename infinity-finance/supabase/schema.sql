-- ─────────────────────────────────────────────────────────────────────────────
-- Infinity Finance — Supabase Schema
-- Run this in your Supabase SQL editor (https://supabase.com/dashboard)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── PROFILES ────────────────────────────────────────────────────────────────
create table public.profiles (
  id              uuid references auth.users on delete cascade primary key,
  username        text,
  avatar_url      text,
  subscription    text not null default 'free' check (subscription in ('free','pro')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_ends_at  timestamptz,  -- Pro access valid until this date (null = no expiry limit)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile"  on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent users from self-modifying billing/subscription columns
CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.subscription IS DISTINCT FROM OLD.subscription OR
    NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id OR
    NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id OR
    NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at
  ) AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'Billing fields cannot be modified directly';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_billing_column_protection
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_billing_columns();

create policy "Service role only can insert profiles"
  on profiles for insert
  with check (false);

-- ─── SETTINGS ────────────────────────────────────────────────────────────────
create table public.settings (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references public.profiles on delete cascade not null unique,
  annual_income   numeric(15,2) not null default 0,
  currency        text not null default 'GBP',
  currency_symbol text not null default '£',
  categories      text[] not null default array['Food','Transport','Entertainment','Shopping','Health','Bills','Housing','Savings','Income','Other'],
  privacy_mode    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.settings enable row level security;
create policy "Users own their settings" on settings for all using (auth.uid() = user_id);

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
create table public.transactions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  amount      numeric(15,2) not null constraint amount_positive check (amount > 0),
  type        text not null check (type in ('income','expense','transfer')),
  category    text not null,
  description text not null default '',
  date        date not null,
  notes       text,
  tags        text[],
  splits      jsonb,          -- [{category, amount}]
  is_recurring boolean not null default false,
  recurring_template_id uuid,
  -- Soft-delete: set to NOW() instead of hard-deleting. Permanent deletion via scheduled job.
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index transactions_user_id_date on transactions(user_id, date desc);
-- Category filtering (used in budget tracking and reports)
create index if not exists idx_transactions_user_category on transactions(user_id, category);

-- Type filtering (income vs expense vs transfer)
create index if not exists idx_transactions_user_type on transactions(user_id, type);

-- Active transactions only (soft-delete support)
CREATE INDEX IF NOT EXISTS idx_transactions_active
  ON transactions(user_id, date)
  WHERE deleted_at IS NULL;

alter table public.transactions enable row level security;
drop policy if exists "Users own their transactions" on transactions;

create policy "Users can read own active transactions"
  on transactions for select
  using (auth.uid() = user_id and deleted_at is null);

create policy "Users can insert own transactions"
  on transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own transactions"
  on transactions for update
  using (auth.uid() = user_id);

create policy "Users can delete own transactions"
  on transactions for delete
  using (auth.uid() = user_id);

-- ─── BILLS ────────────────────────────────────────────────────────────────────
create table public.bills (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  name        text not null,
  amount      numeric(15,2) not null constraint amount_positive check (amount > 0),
  -- Day 28 is the safe maximum that works for all months including February
  day         integer not null check (day >= 1 and day <= 28),
  category    text not null default 'Bills',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz default now()
);

alter table public.bills enable row level security;
create policy "Users own their bills" on bills for all using (auth.uid() = user_id);

-- Bills by user and due date
create index if not exists idx_bills_user_due on bills(user_id, day);

create table public.bill_payments (
  id          uuid primary key default uuid_generate_v4(),
  bill_id     uuid references public.bills on delete cascade not null,
  user_id     uuid references public.profiles on delete cascade not null,
  month_key   text not null,   -- 'YYYY-MM'
  paid        boolean not null default false,
  -- Migration note: ON DELETE SET NULL ensures deleting a transaction nullifies
  -- the reference here instead of erroring or leaving a dangling FK pointer.
  transaction_id uuid references public.transactions(id) on delete set null, -- linked auto-created transaction
  updated_at  timestamptz not null default now(),
  unique(bill_id, month_key)
);

alter table public.bill_payments enable row level security;
create policy "Users own their bill payments" on bill_payments for all using (auth.uid() = user_id);

-- ─── RECURRING TEMPLATES ─────────────────────────────────────────────────────
create table public.recurring_templates (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  description text not null,
  amount      numeric(15,2) not null,
  type        text not null check (type in ('income','expense','transfer')),
  category    text not null,
  day_of_month integer check (day_of_month between 1 and 28),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.recurring_templates enable row level security;
create policy "Users own their templates" on recurring_templates for all using (auth.uid() = user_id);

-- ─── ASSETS ───────────────────────────────────────────────────────────────────
create table public.assets (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  name        text not null,
  type        text not null check (type in ('cash','stocks','crypto','property','pension','other')),
  value       numeric(15,2) not null constraint value_positive check (value >= 0),
  ticker      text,
  quantity    numeric(20,8),
  price_per_unit numeric(15,2),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.assets enable row level security;
create policy "Users own their assets" on assets for all using (auth.uid() = user_id);

-- ─── DEBTS ────────────────────────────────────────────────────────────────────
create table public.debts (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  name        text not null,
  balance     numeric(15,2) not null constraint balance_positive check (balance >= 0),
  apr         numeric(8,4) not null default 0,
  min_payment numeric(15,2) not null default 0,
  type        text not null default 'other' check (type in ('credit_card','loan','mortgage','student','other')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.debts enable row level security;
create policy "Users own their debts" on debts for all using (auth.uid() = user_id);

-- ─── GOALS ────────────────────────────────────────────────────────────────────
create table public.goals (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  name        text not null,
  target      numeric(15,2) not null constraint target_positive check (target > 0),
  current     numeric(15,2) not null default 0,
  notes       text,
  deadline    date,
  emoji       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.goals enable row level security;
create policy "Users own their goals" on goals for all using (auth.uid() = user_id);

-- ─── BUDGETS ──────────────────────────────────────────────────────────────────
create table public.budgets (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  category    text not null,
  amount      numeric(15,2) not null,
  updated_at  timestamptz not null default now(),
  unique(user_id, category)
);

alter table public.budgets enable row level security;
create policy "Users own their budgets" on budgets for all using (auth.uid() = user_id);

-- ─── NET WORTH SNAPSHOTS ──────────────────────────────────────────────────────
-- Upsert pattern: conflict target is (user_id, date) — enforced by the unique
-- constraint below. Use ON CONFLICT (user_id, date) DO UPDATE to overwrite an
-- existing snapshot for the same user+day without inserting a duplicate row.
-- Example: INSERT INTO wealth_snapshots (...) VALUES (...)
--          ON CONFLICT (user_id, date) DO UPDATE SET net_worth = EXCLUDED.net_worth, ...
create table public.wealth_snapshots (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  date        date not null,
  net_worth   numeric(15,2) not null,
  assets_total numeric(15,2) not null,
  debts_total  numeric(15,2) not null,
  unique(user_id, date)
);

alter table public.wealth_snapshots enable row level security;
create policy "Users own their snapshots" on wealth_snapshots for all using (auth.uid() = user_id);

-- ─── UPDATED_AT TRIGGERS ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger set_updated_at before update on public.profiles        for each row execute function set_updated_at();
create trigger set_updated_at before update on public.settings        for each row execute function set_updated_at();
create trigger set_updated_at before update on public.transactions    for each row execute function set_updated_at();
create trigger set_updated_at before update on public.assets          for each row execute function set_updated_at();
create trigger set_updated_at before update on public.debts           for each row execute function set_updated_at();
create trigger set_updated_at before update on public.goals           for each row execute function set_updated_at();
create trigger update_bills_updated_at before update on public.bills  for each row execute function set_updated_at();

-- ─── GDPR: SCHEDULED HARD-DELETE OF SOFT-DELETED RECORDS ─────────────────────
-- GDPR: Hard-delete soft-deleted records older than 90 days
CREATE OR REPLACE FUNCTION purge_soft_deleted_transactions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM transactions
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '90 days';
END;
$$;

-- Note: Schedule this via pg_cron in Supabase dashboard:
-- SELECT cron.schedule('purge-deleted-transactions', '0 3 * * *', 'SELECT purge_soft_deleted_transactions()');

-- ─── PERFORMANCE INDEXES ──────────────────────────────────────────────────────

-- Missing index: bill_payments lookup by user + month (used on every dashboard/bills page load)
CREATE INDEX IF NOT EXISTS idx_bill_payments_user_month ON bill_payments(user_id, month_key);

-- Missing index: wealth_snapshots by user + date (used in net worth chart)
CREATE INDEX IF NOT EXISTS idx_wealth_snapshots_user_date ON wealth_snapshots(user_id, date);

-- Missing index: partial index for GDPR purge query performance
CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NOT NULL;

-- ─── MARK BILL PAID (ATOMIC RPC) ─────────────────────────────────────────────
-- Replaces the 3-step client-side insert/insert/update pattern that could leave
-- orphaned transaction rows if the network dropped between steps 2 and 3.
-- All three writes (bill_payment insert, transaction insert, transaction_id link)
-- execute inside a single implicit PL/pgSQL transaction — they all commit or all
-- roll back together.  RLS on both tables still applies (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.mark_bill_paid(
  p_bill_id      uuid,
  p_month_key    text,
  p_amount       numeric,
  p_category     text,
  p_name         text,
  p_tx_date      date
)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_payment_id   uuid;
  v_tx_id        uuid;
  v_result       json;
BEGIN
  -- Verify the calling user owns the bill before proceeding
  PERFORM 1 FROM bills WHERE id = p_bill_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found or access denied';
  END IF;

  -- Insert bill_payment; RLS policy enforces user_id = auth.uid()
  INSERT INTO bill_payments (bill_id, user_id, month_key, paid)
  VALUES (p_bill_id, auth.uid(), p_month_key, true)
  RETURNING id INTO v_payment_id;

  -- Insert linked transaction
  INSERT INTO transactions (
    user_id, type, amount, category, description,
    date, notes, is_recurring, splits, tags
  )
  VALUES (
    auth.uid(), 'expense', p_amount, p_category, p_name,
    p_tx_date, 'Auto-created for bill: ' || p_name, false, null, ARRAY['bill']
  )
  RETURNING id INTO v_tx_id;

  -- Link the transaction back to the bill_payment
  UPDATE bill_payments
  SET transaction_id = v_tx_id
  WHERE id = v_payment_id;

  -- Return the completed bill_payment row as JSON
  SELECT row_to_json(bp.*) INTO v_result
  FROM bill_payments bp
  WHERE bp.id = v_payment_id;

  RETURN v_result;
END;
$$;

-- Only authenticated users may call this function
REVOKE ALL ON FUNCTION public.mark_bill_paid FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bill_paid TO authenticated;

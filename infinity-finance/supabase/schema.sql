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
  subscription_ends_at timestamptz,
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

-- ─── SETTINGS ────────────────────────────────────────────────────────────────
create table public.settings (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references public.profiles on delete cascade not null unique,
  annual_income   numeric(15,2) not null default 0,
  currency        text not null default 'GBP',
  currency_symbol text not null default '£',
  categories      text[] not null default array['Food','Transport','Entertainment','Shopping','Health','Bills','Housing','Savings','Income','Other'],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.settings enable row level security;
create policy "Users own their settings" on settings for all using (auth.uid() = user_id);

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
create table public.transactions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  amount      numeric(15,2) not null,
  type        text not null check (type in ('income','expense')),
  category    text not null,
  description text not null default '',
  date        date not null,
  notes       text,
  tags        text[],
  splits      jsonb,          -- [{category, amount}]
  is_recurring boolean not null default false,
  recurring_template_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index transactions_user_id_date on transactions(user_id, date desc);
create index transactions_user_id_category on transactions(user_id, category);

alter table public.transactions enable row level security;
create policy "Users own their transactions" on transactions for all using (auth.uid() = user_id);

-- ─── BILLS ────────────────────────────────────────────────────────────────────
create table public.bills (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles on delete cascade not null,
  name        text not null,
  amount      numeric(15,2) not null,
  day         integer not null check (day between 1 and 31),
  category    text not null default 'Bills',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.bills enable row level security;
create policy "Users own their bills" on bills for all using (auth.uid() = user_id);

create table public.bill_payments (
  id          uuid primary key default uuid_generate_v4(),
  bill_id     uuid references public.bills on delete cascade not null,
  user_id     uuid references public.profiles on delete cascade not null,
  month_key   text not null,   -- 'YYYY-MM'
  paid        boolean not null default false,
  transaction_id uuid,         -- linked auto-created transaction
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
  type        text not null check (type in ('income','expense')),
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
  value       numeric(15,2) not null,
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
  balance     numeric(15,2) not null,
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
  target      numeric(15,2) not null,
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

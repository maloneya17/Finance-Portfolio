// Typed payload helpers — workaround for untyped Supabase client
// These interfaces match the schema exactly (see supabase/schema.sql)

export interface TransactionInsert {
  user_id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  category: string
  description: string
  date: string // YYYY-MM-DD
  notes?: string | null
  is_recurring?: boolean
  splits?: unknown | null
  tags?: string[] | null
}

export interface TransactionUpdate extends Partial<Omit<TransactionInsert, 'user_id'>> {}

export interface BillInsert {
  user_id: string
  name: string
  amount: number
  due_day: number
  category?: string | null
  is_active?: boolean
  notes?: string | null
}

export interface BillUpdate extends Partial<Omit<BillInsert, 'user_id'>> {}

export interface BillPaymentInsert {
  bill_id: string
  user_id: string
  month_key: string // YYYY-MM
  paid: boolean
  paid_date?: string | null
  amount?: number | null
  transaction_id?: string | null
}

export interface AssetInsert {
  user_id: string
  name: string
  type: 'cash' | 'stocks' | 'crypto' | 'property' | 'pension' | 'other'
  value: number
  notes?: string | null
}

export interface AssetUpdate extends Partial<Omit<AssetInsert, 'user_id'>> {}

export interface DebtInsert {
  user_id: string
  name: string
  type: 'credit_card' | 'loan' | 'mortgage' | 'student' | 'other'
  balance: number
  apr?: number | null
  min_payment?: number | null
  notes?: string | null
}

export interface DebtUpdate extends Partial<Omit<DebtInsert, 'user_id'>> {}

export interface GoalInsert {
  user_id: string
  name: string
  target_amount: number
  current_amount?: number
  target_date?: string | null
  icon?: string | null
}

export interface GoalUpdate extends Partial<Omit<GoalInsert, 'user_id'>> {}

export interface BudgetUpsert {
  user_id: string
  month_key: string
  category: string
  amount: number
}

export interface ProfileUpdate {
  full_name?: string | null
  avatar_url?: string | null
  subscription?: 'free' | 'pro'
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  subscription_ends_at?: string | null
}

export interface SettingsUpsert {
  user_id: string
  monthly_income?: number | null
  currency?: string
  currency_symbol?: string
  categories?: string[]
  theme?: 'system' | 'light' | 'dark'
  locale?: string
}

// Cast helper: safely converts a typed payload to the unknown type Supabase client expects
// This is the ONLY place where we use a type cast — and it's explicit and documented
export function payload<T>(data: T): T {
  return data
}

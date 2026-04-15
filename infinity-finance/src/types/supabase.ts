export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[]

export type SubscriptionTier = 'free' | 'pro'
export type TransactionType = 'income' | 'expense' | 'transfer'
export type AssetType = 'cash' | 'stocks' | 'crypto' | 'property' | 'pension' | 'other'
export type DebtType = 'credit_card' | 'loan' | 'mortgage' | 'student' | 'other'

export interface SplitEntry {
  category: string
  amount: number
}

// ─── Explicit Insert/Update types (no circular Omit<Database[...]>) ──────────

export interface ProfileInsert {
  id: string
  username?: string | null
  avatar_url?: string | null
  subscription?: SubscriptionTier
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  subscription_ends_at?: string | null
}

export interface SettingsInsert {
  user_id: string
  annual_income?: number
  currency?: string
  currency_symbol?: string
  categories?: string[]
  privacy_mode?: boolean
}

export interface TransactionInsert {
  user_id: string
  amount: number
  type: TransactionType
  category: string
  description: string
  date: string
  notes?: string | null
  tags?: string[] | null
  splits?: Json
  is_recurring?: boolean
  recurring_template_id?: string | null
  deleted_at?: string | null
}

export interface BillInsert {
  user_id: string
  name: string
  amount: number
  day: number
  category?: string
  is_active?: boolean
}

export interface BillPaymentInsert {
  bill_id: string
  user_id: string
  month_key: string
  paid?: boolean
  transaction_id?: string | null
}

export interface BillPaymentUpdate {
  paid?: boolean
  updated_at?: string
  transaction_id?: string | null
}

export interface AssetInsert {
  user_id: string
  name: string
  type: AssetType
  value: number
  ticker?: string | null
  quantity?: number | null
  price_per_unit?: number | null
  notes?: string | null
}

export interface DebtInsert {
  user_id: string
  name: string
  balance: number
  apr?: number
  min_payment?: number
  type?: DebtType
  notes?: string | null
}

export interface GoalInsert {
  user_id: string
  name: string
  target: number
  current?: number
  notes?: string | null
  deadline?: string | null
  emoji?: string | null
}

export interface BudgetInsert {
  user_id: string
  category: string
  amount: number
}

// ─── Database type ────────────────────────────────────────────────────────────
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string | null
          avatar_url: string | null
          subscription: SubscriptionTier
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: ProfileInsert
        Update: Partial<ProfileInsert>
        Relationships: []
      }
      settings: {
        Row: {
          id: string
          user_id: string
          annual_income: number
          currency: string
          currency_symbol: string
          categories: string[]
          privacy_mode: boolean
          created_at: string
          updated_at: string
        }
        Insert: SettingsInsert
        Update: Partial<SettingsInsert>
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          amount: number
          type: TransactionType
          category: string
          description: string
          date: string
          notes: string | null
          tags: string[] | null
          splits: Json
          is_recurring: boolean
          recurring_template_id: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: TransactionInsert
        Update: Partial<TransactionInsert>
        Relationships: []
      }
      bills: {
        Row: {
          id: string
          user_id: string
          name: string
          amount: number
          day: number
          category: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: BillInsert
        Update: Partial<BillInsert>
        Relationships: []
      }
      bill_payments: {
        Row: {
          id: string
          bill_id: string
          user_id: string
          month_key: string
          paid: boolean
          transaction_id: string | null
          updated_at: string
        }
        Insert: BillPaymentInsert
        Update: BillPaymentUpdate
        Relationships: []
      }
      recurring_templates: {
        Row: {
          id: string
          user_id: string
          description: string
          amount: number
          type: TransactionType
          category: string
          day_of_month: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          user_id: string
          description: string
          amount: number
          type: TransactionType
          category: string
          day_of_month?: number | null
          is_active?: boolean
        }
        Update: Partial<{ description: string; amount: number; type: TransactionType; category: string; day_of_month: number | null; is_active: boolean }>
        Relationships: []
      }
      assets: {
        Row: {
          id: string
          user_id: string
          name: string
          type: AssetType
          value: number
          ticker: string | null
          quantity: number | null
          price_per_unit: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: AssetInsert
        Update: Partial<AssetInsert>
        Relationships: []
      }
      debts: {
        Row: {
          id: string
          user_id: string
          name: string
          balance: number
          apr: number
          min_payment: number
          type: DebtType
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: DebtInsert
        Update: Partial<DebtInsert>
        Relationships: []
      }
      goals: {
        Row: {
          id: string
          user_id: string
          name: string
          target: number
          current: number
          notes: string | null
          deadline: string | null
          emoji: string | null
          created_at: string
          updated_at: string
        }
        Insert: GoalInsert
        Update: Partial<GoalInsert>
        Relationships: []
      }
      budgets: {
        Row: {
          id: string
          user_id: string
          category: string
          amount: number
          updated_at: string
        }
        Insert: BudgetInsert
        Update: Partial<BudgetInsert>
        Relationships: []
      }
      wealth_snapshots: {
        Row: {
          id: string
          user_id: string
          date: string
          net_worth: number
          assets_total: number
          debts_total: number
        }
        Insert: {
          user_id: string
          date: string
          net_worth: number
          assets_total: number
          debts_total: number
        }
        Update: Partial<{ net_worth: number; assets_total: number; debts_total: number }>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// ─── Convenience row types ────────────────────────────────────────────────────
export type Profile      = Database['public']['Tables']['profiles']['Row']
export type Settings     = Database['public']['Tables']['settings']['Row']
export type Transaction  = Database['public']['Tables']['transactions']['Row']
export type Bill         = Database['public']['Tables']['bills']['Row']
export type BillPayment  = Database['public']['Tables']['bill_payments']['Row']
export type Asset        = Database['public']['Tables']['assets']['Row']
export type Debt         = Database['public']['Tables']['debts']['Row']
export type Goal         = Database['public']['Tables']['goals']['Row']
export type Budget       = Database['public']['Tables']['budgets']['Row']
export type WealthSnapshot = Database['public']['Tables']['wealth_snapshots']['Row']

export type TxType = 'income' | 'expense';
export type AssetType = 'Savings' | 'Investment' | 'Property' | 'Vehicle' | 'Cash' | 'Other';

export interface Transaction {
  id: string;
  updatedAt: number;
  date?: string;      // YYYY-MM-DD — actual date of transaction (user-set)
  desc: string;
  amount: number;
  category: string;
  type: TxType;
  notes?: string;     // optional memo / extra detail
}

export interface Bill {
  id: string;
  updatedAt: number;
  name: string;
  amount: number;
  day: number;
  category?: string;  // category for auto-created expense, defaults to 'Bills'
  /** Transient flag — set during renderCalendar, not persisted */
  _shifted?: boolean;
}

export interface BillStatusEntry {
  paid: boolean;
  updated: number;
  txId?: string;
}

export interface Asset {
  id: string;
  name: string;
  value: number;
  type: AssetType;
}

export interface Debt {
  id: string;
  name: string;
  value: number;
  interestRate?: number;  // annual % e.g. 5.5 for 5.5% APR
  minPayment?: number;    // monthly minimum payment
}

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  current: number;
  notes?: string;
}

export interface WealthHistory {
  [monthKey: string]: number;
}

export interface WealthData {
  assets: Asset[];
  debts: Debt[];
  history: WealthHistory;
}

export interface RecurringTemplate {
  id: string;
  desc: string;
  amount: number;
  category: string;
  type: TxType;
}

export interface AppDB {
  schemaVersion: number;
  categories: string[];
  transactions: Record<string, Transaction[]>;
  bills: Bill[];
  billStatus: Record<string, Record<string, BillStatusEntry | boolean>>;
  wealth: WealthData;
  deletedIds: string[];
  annualIncome: number;
  cloudURL: string;
  theme: 'light' | 'dark';
  budgets: Record<string, number>;
  recurring: RecurringTemplate[];
  currency: string;       // currency symbol, e.g. '£', '$', '€'
  goals: SavingsGoal[];
  autoRecurring: boolean; // auto-apply recurring templates at month start
}

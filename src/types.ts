export type TxType = 'income' | 'expense';
export type AssetType = 'Savings' | 'Investment' | 'Property' | 'Vehicle' | 'Cash' | 'Other';

export interface SplitEntry {
  category: string;
  amount: number;
  notes?: string;
}

export interface Transaction {
  id: string;
  updatedAt: number;
  date?: string;         // YYYY-MM-DD — actual date of transaction (user-set)
  desc: string;
  amount: number;
  category: string;      // 'Split' when splits[] is populated; otherwise normal category
  type: TxType;
  notes?: string;        // optional memo / extra detail
  tags?: string[];       // user-defined labels e.g. ["tax-deductible", "work", "joint"]
  splits?: SplitEntry[]; // when present, amount is distributed across these sub-categories
  account?: string;      // which account this belongs to (Phase 5A)
  instalmentId?: string; // links transactions in a multi-month instalment plan (Phase 5D)
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
  updatedAt?: number;       // timestamp of last edit — used for last-write-wins sync
  name: string;
  value: number;
  type: AssetType;
  ticker?: string;          // Phase 5E: price ticker e.g. 'BTC', 'AAPL'
  lastPriceUpdate?: number; // timestamp of last auto price fetch
  quantity?: number;        // Phase 5E: units held (for investment assets)
}

export interface Debt {
  id: string;
  updatedAt?: number;   // timestamp of last edit — used for last-write-wins sync
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
  deadline?: string;  // YYYY-MM-DD — optional target completion date
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

/** Phase 5D: represents a lump sum spread as equal monthly instalments. */
export interface InstalmentPlan {
  id: string;
  desc: string;
  totalAmount: number;
  months: number;        // total instalment count
  startMonth: string;    // YYYY-MM key of first instalment
  category: string;
  type: TxType;
  account?: string;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;    // FontAwesome class e.g. 'fas fa-star'
  earned: boolean;
  earnedAt?: string; // YYYY-MM-DD
}

export interface SmartTip {
  id: string;
  type: 'warning' | 'info' | 'success' | 'opportunity';
  icon: string;
  title: string;
  body: string;
  priority: number; // higher = shown first
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
  annualIncomeUpdatedAt: number;  // timestamp of last income change — used for LWW sync
  cloudURL: string;
  theme: 'light' | 'dark';
  budgets: Record<string, number>;
  recurring: RecurringTemplate[];
  currency: string;       // currency symbol, e.g. '£', '$', '€'
  goals: SavingsGoal[];
  autoRecurring: boolean; // auto-apply recurring templates at month start
  lastAutoAppliedMonth: string; // YYYY-MM key of the last month auto-apply ran
  syncPassphrase: string;  // AES-256-GCM passphrase; empty = no encryption
  haptics: boolean;        // vibration feedback on save/warn/celebrate (default true)
  // Phase 5A — accounts
  accounts: string[];      // list of account names, e.g. ['Personal', 'Savings', 'Credit Card']
  // Phase 5D — instalments
  instalmentPlans: InstalmentPlan[];
  // Phase 5C — weekly digest notifications
  weeklyDigest: boolean;
  lastDigestDate: string;  // YYYY-MM-DD of last notification shown
  // Phase 5E — live prices
  alphaVantageKey: string; // user-provided Alpha Vantage API key (optional)
  // Phase 5F — tax year reporting
  taxYearMonth: number;    // 1-12; start month of tax year (default 4 = April for UK)
  reportingPeriod: 'calendar' | 'tax';
}

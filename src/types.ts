export type TxType = 'income' | 'expense';
export type AssetType = 'Savings' | 'Investment' | 'Property' | 'Vehicle' | 'Cash' | 'Other';

export interface Transaction {
  id: string;
  updatedAt: number;
  desc: string;
  amount: number;
  category: string;
  type: TxType;
}

export interface Bill {
  id: string;
  updatedAt: number;
  name: string;
  amount: number;
  day: number;
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
}

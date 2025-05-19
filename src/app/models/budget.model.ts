// src/app/models/budget.model.ts

// --- SimpleFin Data Structures (Exported) ---
export interface Org {
  domain: string;
  name: string;
  'sfin-url': string;
  url: string;
  id: string;
}

export interface RawTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
}

export interface ProcessedTransaction extends RawTransaction {
  accountId: string; 
  orgName: string;
  accountName: string;
  currency: string;
  amountNum: number;
  balanceBefore?: number;
  balanceAfter?: number;
}

export interface Account {
  org: Org;
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions: RawTransaction[];
  holdings: any[];
  balanceNum?: number;
  availableBalanceNum?: number;
}

export interface SimpleFinResponse {
  errors: any[];
  accounts: Account[];
}
// --- End SimpleFin Data Structures ---


// --- Budgeting Logic Models (Fully Defined and Exported) ---
export type FilterableField =
  | 'dayOfWeek'
  | 'weekOfMonth'
  | 'monthOfYear'
  | 'transactionTime'
  | 'orgName'
  | 'accountName'
  | 'payeeName'
  | 'descriptionText'
  | 'amountTransacted'
  | 'balanceBefore'
  | 'balanceAfter'
  | 'postedDate';

export type StringOperator =
  | 'exactMatch'
  | 'contains'
  | 'doesNotContain'
  | 'startsWith'
  | 'endsWith'
  | 'regex';

export type NumericOperator =
  | 'equalTo'
  | 'notEqualTo'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqualTo'
  | 'lessThanOrEqualTo'
  | 'between';

export type DateOperator =
  | 'onDate'
  | 'beforeDate'
  | 'afterDate'
  | 'betweenDates'
  | 'onDayOfWeek'
  | 'inWeekOfMonth'
  | 'inMonthOfYear';

export interface FilterCondition {
  id: string;
  name?: string;
  field: FilterableField;
  operator: StringOperator | NumericOperator | DateOperator;
  value: any;
  value2?: any;
  useAbsoluteAmount?: boolean;
}

export type LogicalOperator = 'AND' | 'OR';

export interface FilterGroup {
  id: string; // Unique ID for the filter group itself
  name?: string; // Optional name for the filter group
  operator: LogicalOperator;
  conditions: FilterCondition[];
  subGroups: FilterGroup[]; // Allows nesting
}

// A Rule is essentially a top-level FilterGroup with a name
export interface Rule {
  id: string; // Unique ID for the rule
  name: string;
  filterGroup: FilterGroup; // The actual logic is a filter group
}


export enum GoalTimePeriodType {
  FIXED_DATE_RANGE = 'fixed_date_range',
  ROLLING_DAYS = 'rolling_days',
  CURRENT_MONTH = 'current_month',
  CURRENT_YEAR = 'current_year',
  ALL_TIME = 'all_time'
}

export enum GoalType {
  SAVINGS = 'savings',
  SPENDING_LIMIT = 'spending_limit'
}

export interface BucketGoal {
  isActive: boolean;
  targetAmount: number;
  goalType: GoalType;
  periodType: GoalTimePeriodType;
  // Optional fields based on periodType
  startDate?: string;     // YYYY-MM-DD, for FIXED_DATE_RANGE
  endDate?: string;       // YYYY-MM-DD, for FIXED_DATE_RANGE
  rollingDays?: number;   // For ROLLING_DAYS
}



export interface Bucket {
  id: string;
  name: string;
  priority: number;
  rules: Array<{ ruleId: string; isActive: boolean }>;
  goal?: BucketGoal;
}

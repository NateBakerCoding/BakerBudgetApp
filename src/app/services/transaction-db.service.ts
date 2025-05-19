// src/app/services/transaction-db.service.ts
import Dexie, { Table } from 'dexie';
import { ProcessedTransaction, Account } from '../models/budget.model';

/**
 * Interface for transactions stored in Dexie. It extends `ProcessedTransaction`
 * by adding a `compoundId` which serves as the primary key for the table.
 * The `compoundId` is typically a combination of `accountId` and `transaction.id`.
 */
export interface StorableTransaction extends ProcessedTransaction {
  /** Compound primary key, typically `${accountId}-${transactionId}`. */
  compoundId: string;
}

/**
 * Interface for storing metadata about data fetch periods.
 * This helps in determining if new data needs to be fetched from the API.
 */
export interface UpdatePeriod {
  /** Unique identifier for the period record (e.g., 'overall_data_range'). */
  id: string;
  /** The start date of the fetched data period, as a Unix timestamp (seconds). */
  startDate: number;
  /** The end date of the fetched data period, as a Unix timestamp (seconds). */
  endDate: number;
  /** The timestamp when this period was last fetched, as a Unix timestamp (seconds). */
  lastFetched: number;
}

/**
 * Interface for accounts stored in Dexie. Currently, it's a direct extension of the `Account` model.
 * This allows for potential future additions of DB-specific fields to `StorableAccount`
 * without altering the base `Account` model.
 */
export interface StorableAccount extends Account {
  // No additional fields currently, but provides a distinct type for Dexie storage.
}

/**
 * Interface for storing the state of UI elements, such as whether a section is folded or expanded.
 */
export interface UiElementState {
  /** Unique identifier for the UI element (e.g., 'dashboardAccountSummaryFolded'). This is the primary key. */
  id: string;
  /** Boolean indicating if the UI element is in a "folded" or "collapsed" state. */
  isFolded: boolean;
}

/**
 * TransactionDB class extends Dexie to define the IndexedDB database schema and tables
 * for the SimpleFinBudget application. It handles database versioning and schema upgrades.
 *
 * Tables:
 * - `transactions`: Stores financial transactions (`StorableTransaction`).
 * - `updatePeriods`: Stores metadata about data fetch periods (`UpdatePeriod`).
 * - `accounts`: Stores financial account details (`StorableAccount`).
 * - `uiStates`: Stores UI element states like folded/unfolded sections (`UiElementState`).
 */
export class TransactionDB extends Dexie {
  /** Table for storing processed financial transactions. Primary key is `compoundId`. */
  transactions!: Table<StorableTransaction, string>; // string = type of the primary key (compoundId)
  /** Table for storing metadata about data fetch periods. Primary key is `id`. */
  updatePeriods!: Table<UpdatePeriod, string>;      // string = type of the primary key (id)
  /** Table for storing financial account details. Primary key is `id` (from Account model). */
  accounts!: Table<StorableAccount, string>;        // string = type of the primary key (Account.id)
  /** Table for storing UI element states. Primary key is `id`. */
  uiStates!: Table<UiElementState, string>;          // string = type of the primary key (UiElementState.id)

  constructor() {
    super('SimpleFinBudgetDB'); // Database name

    // Schema version 1: Initial transactions table.
    this.version(1).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency',
      // compoundId: Primary key.
      // Other fields are indexed to allow querying/sorting on them.
    });

    // Schema version 2: Added updatePeriods table.
    this.version(2).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency', // Unchanged
      updatePeriods: 'id, lastFetched' // id: Primary key. lastFetched: Indexed.
    });

    // Schema version 3: Added accounts table.
    this.version(3).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency', // Unchanged
      updatePeriods: 'id, lastFetched', // Unchanged
      accounts: 'id, org.name, name' // id: Primary key. org.name, name: Indexed for potential lookups.
    });

    // Schema version 4: Added uiStates table.
    this.version(4).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency', // Unchanged
      updatePeriods: 'id, lastFetched', // Unchanged
      accounts: 'id, org.name, name', // Unchanged
      uiStates: 'id' // id: Primary key.
    }).upgrade(tx => {
      // This upgrade function is called if an existing DB is older than version 4.
      // It's a good place for data migration if schema changes require it, but here we just log.
      console.log("Upgrading DB to version 4: Adding uiStates store.");
      // No data migration needed as it's a new table.
    });

    // Note on schema definition:
    // The string format for .stores() is a Dexie-specific syntax.
    // 'primaryKey, index1, index2, ...indexN'
    // If primary key is auto-incrementing, use '++primaryKey'.
    // Compound indexes can be defined as '[index1+index2]'.
  }
}

/** Singleton instance of the TransactionDB, used throughout the application to interact with the database. */
export const db = new TransactionDB();

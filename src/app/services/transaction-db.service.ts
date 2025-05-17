// src/app/services/transaction-db.service.ts
import Dexie, { Table } from 'dexie';
import { ProcessedTransaction, Account } from '../models/budget.model';

export interface StorableTransaction extends ProcessedTransaction {
  compoundId: string;
}

export interface UpdatePeriod {
  id: string;
  startDate: number;
  endDate: number;
  lastFetched: number;
}

export interface StorableAccount extends Account {
  // Using Account directly
}

// New interface for UI states
export interface UiElementState {
  id: string; // Unique identifier for the UI element, e.g., 'dashboardAccountSummaryFolded'
  isFolded: boolean;
}

export class TransactionDB extends Dexie {
  transactions!: Table<StorableTransaction, string>;
  updatePeriods!: Table<UpdatePeriod, string>;
  accounts!: Table<StorableAccount, string>;
  uiStates!: Table<UiElementState, string>; // New table for UI states

  constructor() {
    super('SimpleFinBudgetDB');

    this.version(1).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency',
    });
    this.version(2).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency',
      updatePeriods: 'id, lastFetched'
    });
    this.version(3).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency',
      updatePeriods: 'id, lastFetched',
      accounts: 'id, org.name, name'
    });

    // Add a new version for the 'uiStates' store
    this.version(4).stores({
      transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency',
      updatePeriods: 'id, lastFetched',
      accounts: 'id, org.name, name',
      uiStates: 'id' // 'id' is the primary key (e.g., 'dashboardAccountSummaryFolded')
    }).upgrade(tx => {
      console.log("Upgrading DB to version 4: Adding uiStates store.");
    });

    // If starting fresh and no users have v1, v2, or v3:
    // this.version(1).stores({
    //   transactions: 'compoundId, posted, orgName, accountName, payeeName, descriptionText, amountNum, currency',
    //   updatePeriods: 'id, lastFetched',
    //   accounts: 'id, org.name, name',
    //   uiStates: 'id'
    // });
  }
}

export const db = new TransactionDB();

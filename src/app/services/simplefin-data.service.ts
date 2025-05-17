// src/app/services/simplefin-data.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, tap, finalize, switchMap, map } from 'rxjs/operators';
import { Account, ProcessedTransaction, SimpleFinResponse } from '../models/budget.model';
import { db, StorableTransaction, UpdatePeriod, StorableAccount } from './transaction-db.service';

// Constants for localStorage keys for access details
const LS_RAW_ACCESS_URL_KEY = 'sfin_raw_access_url';
const LS_PARSED_BASE_URL_KEY = 'sfin_parsed_base_url';
const LS_AUTH_HEADER_KEY = 'sfin_auth_header';
const LS_CONFIGURED_START_DATE_KEY = 'sfin_configuredStartDate'; // For persisting configured start date

const DEFAULT_FETCH_PERIOD_ID = 'overall_data_range';
const DEFAULT_HISTORY_YEARS = 2;

@Injectable({
  providedIn: 'root'
})
export class SimpleFinDataService {
  // Observables for components to subscribe to
  private accountsSubject = new BehaviorSubject<Account[]>([]);
  accounts$: Observable<Account[]> = this.accountsSubject.asObservable();

  private transactionsSubject = new BehaviorSubject<ProcessedTransaction[]>([]);
  transactions$: Observable<ProcessedTransaction[]> = this.transactionsSubject.asObservable();

  private isLoadingSubject = new BehaviorSubject<boolean>(false);
  isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  public errorMessageSubject = new BehaviorSubject<string | null>(null);
  errorMessage$: Observable<string | null> = this.errorMessageSubject.asObservable();

  private _hasStoredAccessDetailsSubject = new BehaviorSubject<boolean>(false);
  public hasStoredAccessDetails$: Observable<boolean> = this._hasStoredAccessDetailsSubject.asObservable();

  // SimpleFin access details (public for direct access from AllInfoComponent template if needed for debug)
  public rawAccessUrl: string = '';
  public parsedBaseUrl: string = '';
  public claimUrlForDisplay: string = ''; // For displaying the decoded claim URL

  private dataAuthHeader: string | null = null;

  // Expose dataAuthHeader if needed for display, otherwise keep private
  get authHeaderForDisplay(): string | null {
    return this.dataAuthHeader;
  }

  // Configuration for data fetching period
  private configuredStartDate: Date;

  constructor(private http: HttpClient) {
    const storedStartDateString = localStorage.getItem(LS_CONFIGURED_START_DATE_KEY);
    if (storedStartDateString) {
        const storedDate = new Date(storedStartDateString);
        if (!isNaN(storedDate.getTime())) {
            this.configuredStartDate = storedDate;
        } else {
            this.configuredStartDate = this.getDefaultStartDate();
        }
    } else {
        this.configuredStartDate = this.getDefaultStartDate();
    }

    this.loadAccessDetailsFromStorage(); // This also emits _hasStoredAccessDetailsSubject
    if (this._hasStoredAccessDetailsSubject.value) {
      Promise.all([this.loadAccountsFromDB(), this.loadTransactionsFromDB()]).then(() => {
        this.autoUpdateDataIfNeeded(false);
      }).catch(err => {
        console.error("Error during initial DB load:", err);
        this.autoUpdateDataIfNeeded(false);
      });
    }
  }

  private getDefaultStartDate(): Date {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - DEFAULT_HISTORY_YEARS);
    twoYearsAgo.setHours(0, 0, 0, 0);
    return twoYearsAgo;
  }

  private loadAccessDetailsFromStorage(): void {
    const storedRawUrl = localStorage.getItem(LS_RAW_ACCESS_URL_KEY);
    const storedParsedUrl = localStorage.getItem(LS_PARSED_BASE_URL_KEY);
    const storedAuthHeader = localStorage.getItem(LS_AUTH_HEADER_KEY);
    let hasDetails = false;

    if (storedParsedUrl && (storedAuthHeader || (storedRawUrl && !storedRawUrl.includes('@')))) {
      this.rawAccessUrl = storedRawUrl || '';
      this.parsedBaseUrl = storedParsedUrl;
      this.dataAuthHeader = storedAuthHeader || null;
      hasDetails = true;
    } else {
      this.rawAccessUrl = '';
      this.parsedBaseUrl = '';
      this.dataAuthHeader = null;
      hasDetails = false;
    }
    this._hasStoredAccessDetailsSubject.next(hasDetails);
  }

  private saveAccessDetailsToStorage(): void {
    if (this.parsedBaseUrl) {
      localStorage.setItem(LS_RAW_ACCESS_URL_KEY, this.rawAccessUrl);
      localStorage.setItem(LS_PARSED_BASE_URL_KEY, this.parsedBaseUrl);
      if (this.dataAuthHeader) {
        localStorage.setItem(LS_AUTH_HEADER_KEY, this.dataAuthHeader);
      } else {
        localStorage.removeItem(LS_AUTH_HEADER_KEY);
      }
    }
    this.loadAccessDetailsFromStorage(); // Reload to update subject and public properties
  }

  public clearStoredAccessDetails(): void {
    localStorage.removeItem(LS_RAW_ACCESS_URL_KEY);
    localStorage.removeItem(LS_PARSED_BASE_URL_KEY);
    localStorage.removeItem(LS_AUTH_HEADER_KEY);
    localStorage.removeItem(LS_CONFIGURED_START_DATE_KEY); // Clear configured start date too

    this.rawAccessUrl = '';
    this.parsedBaseUrl = '';
    this.dataAuthHeader = null;
    this.claimUrlForDisplay = '';
    this.configuredStartDate = this.getDefaultStartDate(); // Reset to default

    this.accountsSubject.next([]);
    this.transactionsSubject.next([]);
    this.errorMessageSubject.next('Stored access details and local data cleared.');
    this._hasStoredAccessDetailsSubject.next(false);

    Promise.all([
        db.transactions.clear(),
        db.updatePeriods.clear(),
        db.accounts.clear()
    ]).then(() => console.log('Cleared all data from DB.'))
      .catch(err => console.error("Error clearing DB:", err));
  }

  public getConfiguredStartDate(): Date {
    return new Date(this.configuredStartDate.getTime());
  }

  public setConfiguredStartDate(date: Date): void {
    const newStartDate = new Date(date.getTime());
    newStartDate.setHours(0, 0, 0, 0);
    this.configuredStartDate = newStartDate;
    localStorage.setItem(LS_CONFIGURED_START_DATE_KEY, this.configuredStartDate.toISOString());
    console.log('Configured start date set to:', this.configuredStartDate);
    this.autoUpdateDataIfNeeded(true).catch(e => console.error("Error auto-updating after date set:", e));
  }

  private async getLatestUpdatePeriod(): Promise<UpdatePeriod | undefined> {
    try {
      return await db.updatePeriods.get(DEFAULT_FETCH_PERIOD_ID);
    } catch (error) {
      console.error("Error getting latest update period:", error);
      return undefined;
    }
  }

  private async saveUpdatePeriod(startDate: Date, endDate: Date): Promise<void> {
    const period: UpdatePeriod = {
      id: DEFAULT_FETCH_PERIOD_ID,
      startDate: Math.floor(startDate.getTime() / 1000),
      endDate: Math.floor(endDate.getTime() / 1000),
      lastFetched: Math.floor(Date.now() / 1000)
    };
    try {
      await db.updatePeriods.put(period);
      console.log('Update period saved:', period);
    } catch (error) {
      console.error("Error saving update period:", error);
    }
  }

  public async autoUpdateDataIfNeeded(forceUpdate: boolean): Promise<void> {
    if (!this._hasStoredAccessDetailsSubject.value) {
      this.errorMessageSubject.next("No access details. Please provide a setup token.");
      // Try to load any existing data from DB even if no access details for offline view
      await this.loadAccountsFromDB();
      await this.loadTransactionsFromDB();
      return;
    }

    this.isLoadingSubject.next(true);
    const targetStartDate = new Date(this.configuredStartDate);
    targetStartDate.setHours(0, 0, 0, 0);

    const today = new Date();
    const beginningOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // For comparison

    const latestPeriod = await this.getLatestUpdatePeriod();

    if (!forceUpdate && latestPeriod) {
      const storedStartDate = new Date(latestPeriod.startDate * 1000);
      const storedEndDate = new Date(latestPeriod.endDate * 1000); // When the data was fetched up to

      const coversTargetStart = storedStartDate.getTime() <= targetStartDate.getTime();
      const isDataRecentEnough = storedEndDate.getTime() >= beginningOfToday.getTime();

      if (coversTargetStart && isDataRecentEnough) {
        console.log('Data is recent and covers configured range. Loading from DB.');
        await this.loadAccountsFromDB();
        await this.loadTransactionsFromDB();
        this.isLoadingSubject.next(false);
        return;
      } else {
        console.log('Data outdated or does not cover full range. Fetching new data. Stored Period End:', storedEndDate, 'Target Start:', targetStartDate, 'Is Recent:', isDataRecentEnough, 'Covers Target:', coversTargetStart);
      }
    } else if (forceUpdate) {
      console.log('Force update requested. Fetching new data.');
    } else {
      console.log('No existing update period or initial load with missing data. Fetching data.');
    }

    this.fetchDataFromSimpleFin(targetStartDate.toISOString().split('T')[0])
      .subscribe({
        next: () => {
          this.saveUpdatePeriod(targetStartDate, new Date()); // Save with today as end date
          console.log('Data fetch successful as part of auto-update, update period recorded.');
        },
        error: (err) => {
            console.error('Error during auto-update fetch:', err);
        }
      });
  }

  public claimAndFetchData(setupToken: string): Observable<void> {
    if (!setupToken) {
      this.errorMessageSubject.next('Setup Token is required.');
      this.isLoadingSubject.next(false);
      return throwError(() => new Error('Setup Token is required.'));
    }
    this.isLoadingSubject.next(true);
    this.errorMessageSubject.next(null);
    this.accountsSubject.next([]);
    this.transactionsSubject.next([]);

    let claimUrl = '';
    try {
      claimUrl = atob(setupToken);
      this.claimUrlForDisplay = claimUrl;
    } catch (e) {
      this.claimUrlForDisplay = '';
      this.errorMessageSubject.next('Invalid Base64 Setup Token.');
      this.isLoadingSubject.next(false);
      return throwError(() => new Error('Invalid Base64 Setup Token.'));
    }

    return this.http.post(claimUrl, null, {
      headers: new HttpHeaders({ 'Content-Length': '0' }),
      responseType: 'text'
    }).pipe(
      switchMap(accessUrlResponse => {
        if (!accessUrlResponse) {
          this.isLoadingSubject.next(false);
          return throwError(() => new Error('Failed to retrieve Access URL (empty response).'));
        }
        this.rawAccessUrl = accessUrlResponse;
        try {
          const url = new URL(this.rawAccessUrl);
          const username = url.username;
          const password = url.password;
          this.parsedBaseUrl = `${url.protocol}//${url.host}${url.pathname}`;

          if (username) {
            const credentialsToEncode = password ? `${username}:${password}` : username;
            this.dataAuthHeader = `Basic ${btoa(credentialsToEncode)}`;
          } else {
            this.dataAuthHeader = null;
          }
          this.saveAccessDetailsToStorage(); // This will update properties and _hasStoredAccessDetailsSubject

          const startDateForFetch = this.configuredStartDate.toISOString().split('T')[0];
          return this.fetchDataFromSimpleFin(startDateForFetch).pipe(
              tap(() => this.saveUpdatePeriod(this.configuredStartDate, new Date()))
          );
        } catch (e: any) {
          this.isLoadingSubject.next(false);
          return throwError(() => new Error(`Invalid Access URL format: ${this.rawAccessUrl}. Error: ${e.message}`));
        }
      }),
      tap(() => {
        this.errorMessageSubject.next(null);
      }),
      catchError(err => {
        this.errorMessageSubject.next(err.message || 'Failed to claim and fetch data.');
        console.error("Claim and fetch error:", err);
        this.isLoadingSubject.next(false);
        return throwError(() => err);
      })
      // finalize is handled by individual fetchDataFromSimpleFin
    );
  }

  public fetchDataFromSimpleFin(startDateForAPI?: string): Observable<void> {
    if (!this.parsedBaseUrl) {
      this.errorMessageSubject.next('No Access URL available.');
      this.isLoadingSubject.next(false);
      return throwError(() => new Error('No Access URL available.'));
    }
    this.isLoadingSubject.next(true);
    this.errorMessageSubject.next(null);

    let requestHeaders = new HttpHeaders();
    if (this.dataAuthHeader) {
      requestHeaders = requestHeaders.set('Authorization', this.dataAuthHeader);
    }

    let httpParams = new HttpParams();
    if (startDateForAPI) {
       const dateObj = new Date(startDateForAPI + 'T00:00:00Z'); // Assume start of day UTC for API
       if (!isNaN(dateObj.getTime())) {
           const unixTimestampSeconds = Math.floor(dateObj.getTime() / 1000);
           httpParams = httpParams.set('start-date', unixTimestampSeconds.toString());
       } else {
            this.errorMessageSubject.next('Invalid Start Date for API call.');
            this.isLoadingSubject.next(false);
            return throwError(() => new Error('Invalid Start Date for API call.'));
       }
    }

    return this.http.get<SimpleFinResponse>(`${this.parsedBaseUrl}/accounts`, {
      headers: requestHeaders,
      params: httpParams
    }).pipe(
      tap(async response => {
        if (response && response.accounts) {
          if (startDateForAPI) { // Full range refresh implies clearing old data
              try {
                await Promise.all([db.transactions.clear(), db.accounts.clear()]);
                console.log("Cleared existing transactions and accounts from DB before new full fetch.");
              } catch (dbError) { console.error("Error clearing DB stores:", dbError); }
          }

          const { accounts, processedTransactions } = this.processRawData(response);
          
          await this.saveAccountsToDB(accounts);
          this.accountsSubject.next(accounts);

          await this.saveTransactionsToDB(processedTransactions);
          this.transactionsSubject.next(processedTransactions);
          
          this.errorMessageSubject.next(null);
        } else if (response && response.errors && response.errors.length > 0) {
          this.errorMessageSubject.next(`API Errors: ${response.errors.map(e => JSON.stringify(e)).join(', ')}`);
          this.accountsSubject.next([]);
          this.transactionsSubject.next([]);
        } else {
          this.errorMessageSubject.next('Empty or unexpected response from API.');
          this.accountsSubject.next([]);
          this.transactionsSubject.next([]);
        }
      }),
      map(() => undefined),
      catchError(err => {
        this.errorMessageSubject.next(err.message || 'Failed to fetch data from SimpleFin.');
        console.error("Fetch data error:", err);
        this.accountsSubject.next([]);
        this.transactionsSubject.next([]);
        return throwError(() => err);
      }),
      finalize(() => this.isLoadingSubject.next(false))
    );
  }

  private processRawData(data: SimpleFinResponse): { accounts: Account[], processedTransactions: ProcessedTransaction[] } {
    const allProcessedTransactions: ProcessedTransaction[] = [];
    const finalAccounts: Account[] = data.accounts.map(account => {
      const accBalanceNum = parseFloat(account.balance);
      const accAvailableBalanceNum = account['available-balance'] ? parseFloat(account['available-balance']) : accBalanceNum;

      if (account.transactions && account.transactions.length > 0) {
        let runningBalance = accBalanceNum;
        const descRawTransactions = [...account.transactions].sort((a, b) =>
          (b.posted ?? b.transacted_at ?? 0) - (a.posted ?? a.transacted_at ?? 0)
        );

        descRawTransactions.forEach(rawTx => {
          const amountNum = parseFloat(rawTx.amount);
          const balanceAfter = runningBalance;
          const balanceBefore = runningBalance - amountNum;

          allProcessedTransactions.push({
            ...rawTx,
            accountId: account.id, // Ensure accountId is populated
            orgName: account.org.name,
            accountName: account.name,
            currency: account.currency,
            amountNum: amountNum,
            balanceBefore: balanceBefore,
            balanceAfter: balanceAfter,
          });
          runningBalance = balanceBefore;
        });
      }
      return { ...account, balanceNum: accBalanceNum, availableBalanceNum: accAvailableBalanceNum, transactions: account.transactions };
    });
    
    allProcessedTransactions.sort((a, b) => (b.posted ?? b.transacted_at ?? 0) - (a.posted ?? a.transacted_at ?? 0));
    return { accounts: finalAccounts, processedTransactions: allProcessedTransactions };
  }

  private async saveTransactionsToDB(transactions: ProcessedTransaction[]): Promise<void> {
    if (!transactions || transactions.length === 0) return;

    const storableTxs: StorableTransaction[] = transactions.map(tx => {
      // Ensure tx.accountId is present from processRawData
      if (!tx.accountId) {
          console.warn("Transaction missing accountId, cannot form reliable compoundId:", tx);
          // Fallback or skip, here we'll try with orgName/accountName but it's less robust
          const accountIdentifier = `${tx.orgName}-${tx.accountName}`;
          return { ...tx, compoundId: `${accountIdentifier}-${tx.id}` };
      }
      return {
        ...tx,
        compoundId: `${tx.accountId}-${tx.id}`
      };
    });

    try {
      await db.transactions.bulkPut(storableTxs);
      console.log(`${storableTxs.length} transactions saved/updated in Dexie.`);
    } catch (error) {
      console.error('Error saving transactions to Dexie:', error);
      this.errorMessageSubject.next('Failed to save transactions to local database.');
    }
  }

  public async loadTransactionsFromDB(): Promise<void> {
    // isLoading state is managed by the calling function (e.g. autoUpdateDataIfNeeded)
    try {
      const storedTxs = await db.transactions.orderBy('posted').reverse().toArray();
      const loadedTransactions: ProcessedTransaction[] = storedTxs.map(stx => {
        const { compoundId, ...tx } = stx;
        return tx as ProcessedTransaction;
      });
      this.transactionsSubject.next(loadedTransactions);
      
      const currentError = this.errorMessageSubject.value;
      if (!currentError || !currentError.includes('accounts')) { // Don't clear if accounts failed to load
          this.errorMessageSubject.next(null);
      }
      console.log(`${loadedTransactions.length} transactions loaded from Dexie (newer first).`);
    } catch (error) {
      console.error('Error loading transactions from Dexie:', error);
      const currentError = this.errorMessageSubject.value;
      const newError = 'Failed to load transactions from local database.';
      this.errorMessageSubject.next(currentError ? `${currentError} ${newError}` : newError);
      this.transactionsSubject.next([]);
    }
  }

  // --- New Dexie DB Operations for Accounts ---
  private async saveAccountsToDB(accounts: Account[]): Promise<void> {
    if (!accounts || accounts.length === 0) return;

    const storableAccounts: StorableAccount[] = accounts.map(acc => ({
        ...acc
    }));

    try {
      await db.accounts.bulkPut(storableAccounts);
      console.log(`${storableAccounts.length} accounts saved/updated in Dexie.`);
    } catch (error) {
      console.error('Error saving accounts to Dexie:', error);
      this.errorMessageSubject.next('Failed to save accounts to local database.');
    }
  }

  public async loadAccountsFromDB(): Promise<void> {
    // isLoading state is managed by the calling function
    try {
      const storedAccounts = await db.accounts.toArray();
      this.accountsSubject.next(storedAccounts as Account[]);
      // Don't clear error here, let the overall process decide
      console.log(`${storedAccounts.length} accounts loaded from Dexie.`);
    } catch (error) {
      console.error('Error loading accounts from Dexie:', error);
      const currentError = this.errorMessageSubject.value;
      const newError = 'Failed to load accounts from local database.';
      this.errorMessageSubject.next(currentError ? `${currentError} ${newError}` : newError);
      this.accountsSubject.next([]);
    }
  }
}

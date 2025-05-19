// src/app/services/simplefin-data.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, tap, finalize, switchMap, map } from 'rxjs/operators';
import { Account, ProcessedTransaction, SimpleFinResponse } from '../models/budget.model';
import { db, StorableTransaction, UpdatePeriod, StorableAccount } from './transaction-db.service';

// --- Constants for localStorage keys ---
/** Key for storing the raw SimpleFin access URL (which might contain credentials). */
const LS_RAW_ACCESS_URL_KEY = 'sfin_raw_access_url';
/** Key for storing the parsed base URL for SimpleFin API calls (scheme, host, path, without credentials). */
const LS_PARSED_BASE_URL_KEY = 'sfin_parsed_base_url';
/** Key for storing the Authorization header value (e.g., "Basic dXNlcjpwYXNz"). */
const LS_AUTH_HEADER_KEY = 'sfin_auth_header';
/** Key for storing the user-configured start date for fetching transactions. */
const LS_CONFIGURED_START_DATE_KEY = 'sfin_configuredStartDate';

/** Default ID used in Dexie for storing the overall data fetch period information. */
const DEFAULT_FETCH_PERIOD_ID = 'overall_data_range';
/** Default number of years of transaction history to fetch if no start date is configured. */
const DEFAULT_HISTORY_YEARS = 2;

/**
 * SimpleFinDataService manages all interactions with the SimpleFin API.
 * This includes:
 * - Claiming an access URL using a setup token.
 * - Storing and retrieving API access details (URL, auth header) from localStorage.
 * - Fetching account and transaction data from the SimpleFin API.
 * - Processing raw transaction data to include calculated running balances.
 * - Storing fetched accounts and transactions locally using Dexie (IndexedDB).
 * - Providing BehaviorSubjects to expose accounts, transactions, loading state, error messages,
 *   and the availability of stored access details to other parts of the application.
 * - Handling data refresh logic based on a configured start date and last fetched period.
 */
@Injectable({
  providedIn: 'root'
})
export class SimpleFinDataService {
  // --- BehaviorSubjects for State Management ---
  /** BehaviorSubject holding the current array of accounts. Components subscribe to `accounts$`. */
  private accountsSubject = new BehaviorSubject<Account[]>([]);
  /** Observable stream of accounts. */
  accounts$: Observable<Account[]> = this.accountsSubject.asObservable();

  /** BehaviorSubject holding the current array of processed transactions. Components subscribe to `transactions$`. */
  private transactionsSubject = new BehaviorSubject<ProcessedTransaction[]>([]);
  /** Observable stream of processed transactions. */
  transactions$: Observable<ProcessedTransaction[]> = this.transactionsSubject.asObservable();

  /** BehaviorSubject indicating if any data fetching operation is currently in progress. */
  private isLoadingSubject = new BehaviorSubject<boolean>(false);
  /** Observable stream of the loading state. */
  isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  /** BehaviorSubject holding the latest error message string, or null if no error. */
  public errorMessageSubject = new BehaviorSubject<string | null>(null);
  /** Observable stream of error messages. */
  errorMessage$: Observable<string | null> = this.errorMessageSubject.asObservable();

  /** BehaviorSubject indicating whether SimpleFin access details are currently stored in localStorage. */
  private _hasStoredAccessDetailsSubject = new BehaviorSubject<boolean>(false);
  /** Observable stream indicating if access details are stored. */
  public hasStoredAccessDetails$: Observable<boolean> = this._hasStoredAccessDetailsSubject.asObservable();

  // --- SimpleFin Access Details ---
  /** The raw access URL obtained from SimpleFin, potentially containing credentials. Displayed for debugging. */
  public rawAccessUrl: string = '';
  /** The parsed base URL for API calls (scheme, host, path). */
  public parsedBaseUrl: string = '';
  /** The decoded setup token URL, displayed for debugging after a claim attempt. */
  public claimUrlForDisplay: string = '';

  /** The Authorization header value (e.g., "Basic dXNlcjpwYXNz") used for API calls. Null if not applicable. */
  private dataAuthHeader: string | null = null;

  /** Getter to expose the dataAuthHeader for display/debugging purposes if needed. */
  get authHeaderForDisplay(): string | null {
    return this.dataAuthHeader;
  }

  /** User-configured start date for fetching transaction history. */
  private configuredStartDate: Date;

  constructor(private http: HttpClient) {
    // Load configured start date from localStorage or set to default.
    const storedStartDateString = localStorage.getItem(LS_CONFIGURED_START_DATE_KEY);
    if (storedStartDateString) {
        const storedDate = new Date(storedStartDateString);
        if (!isNaN(storedDate.getTime())) {
            this.configuredStartDate = storedDate;
        } else {
            this.configuredStartDate = this.getDefaultStartDate(); // Handle invalid date string
        }
    } else {
        this.configuredStartDate = this.getDefaultStartDate();
    }

    // Load access details from storage, which also updates _hasStoredAccessDetailsSubject.
    this.loadAccessDetailsFromStorage();
    if (this._hasStoredAccessDetailsSubject.value) {
      // If access details exist, attempt to load data from DB and then auto-update if needed.
      Promise.all([this.loadAccountsFromDB(), this.loadTransactionsFromDB()]).then(() => {
        this.autoUpdateDataIfNeeded(false); // Check if data needs refreshing
      }).catch(err => {
        console.error("Error during initial DB load:", err);
        this.autoUpdateDataIfNeeded(false); // Still try to update even if DB load failed
      });
    }
  }

  /**
   * Calculates the default start date for fetching transactions (typically 2 years ago).
   * @returns A Date object set to the beginning of the day, `DEFAULT_HISTORY_YEARS` ago.
   */
  private getDefaultStartDate(): Date {
    const yearsAgo = new Date();
    yearsAgo.setFullYear(yearsAgo.getFullYear() - DEFAULT_HISTORY_YEARS);
    yearsAgo.setHours(0, 0, 0, 0); // Normalize to start of the day
    return yearsAgo;
  }

  /**
   * Loads SimpleFin access details (raw URL, parsed base URL, auth header) from localStorage.
   * Updates the service's internal state and emits `_hasStoredAccessDetailsSubject`.
   */
  private loadAccessDetailsFromStorage(): void {
    const storedRawUrl = localStorage.getItem(LS_RAW_ACCESS_URL_KEY);
    const storedParsedUrl = localStorage.getItem(LS_PARSED_BASE_URL_KEY);
    const storedAuthHeader = localStorage.getItem(LS_AUTH_HEADER_KEY);
    let hasDetails = false;

    // Check if essential details are present.
    // The auth header might be null if the URL itself is a token-based one without Basic Auth.
    if (storedParsedUrl && (storedAuthHeader || (storedRawUrl && !storedRawUrl.includes('@')))) {
      this.rawAccessUrl = storedRawUrl || '';
      this.parsedBaseUrl = storedParsedUrl;
      this.dataAuthHeader = storedAuthHeader || null;
      hasDetails = true;
    } else {
      // Clear local state if details are incomplete/missing.
      this.rawAccessUrl = '';
      this.parsedBaseUrl = '';
      this.dataAuthHeader = null;
      hasDetails = false;
    }
    this._hasStoredAccessDetailsSubject.next(hasDetails); // Notify subscribers about availability
  }

  /**
   * Saves the current SimpleFin access details (raw URL, parsed base URL, auth header) to localStorage.
   * After saving, it reloads the details to ensure consistency and notify subscribers.
   */
  private saveAccessDetailsToStorage(): void {
    if (this.parsedBaseUrl) { // Only save if we have a parsed base URL
      localStorage.setItem(LS_RAW_ACCESS_URL_KEY, this.rawAccessUrl);
      localStorage.setItem(LS_PARSED_BASE_URL_KEY, this.parsedBaseUrl);
      if (this.dataAuthHeader) {
        localStorage.setItem(LS_AUTH_HEADER_KEY, this.dataAuthHeader);
      } else {
        localStorage.removeItem(LS_AUTH_HEADER_KEY); // Remove if auth header is null
      }
    }
    this.loadAccessDetailsFromStorage(); // Reload to update subjects and ensure consistency
  }

  /**
   * Clears all stored SimpleFin access details from localStorage and resets the service's state.
   * This includes access URLs, auth headers, configured start date, and local Dexie DB data.
   * BehaviorSubjects are updated to reflect the cleared state.
   */
  public clearStoredAccessDetails(): void {
    // Remove items from localStorage
    localStorage.removeItem(LS_RAW_ACCESS_URL_KEY);
    localStorage.removeItem(LS_PARSED_BASE_URL_KEY);
    localStorage.removeItem(LS_AUTH_HEADER_KEY);
    localStorage.removeItem(LS_CONFIGURED_START_DATE_KEY);

    // Reset internal service state
    this.rawAccessUrl = '';
    this.parsedBaseUrl = '';
    this.dataAuthHeader = null;
    this.claimUrlForDisplay = '';
    this.configuredStartDate = this.getDefaultStartDate(); // Reset start date to default

    // Update BehaviorSubjects
    this.accountsSubject.next([]);
    this.transactionsSubject.next([]);
    this.errorMessageSubject.next('Stored access details and local data cleared.');
    this._hasStoredAccessDetailsSubject.next(false);

    // Clear Dexie database
    Promise.all([
        db.transactions.clear(),
        db.updatePeriods.clear(),
        db.accounts.clear()
    ]).then(() => console.log('Cleared all data from Dexie DB.'))
      .catch(err => console.error("Error clearing Dexie DB:", err));
  }

  /**
   * Retrieves the currently configured start date for fetching transactions.
   * @returns A new Date object representing the configured start date.
   */
  public getConfiguredStartDate(): Date {
    return new Date(this.configuredStartDate.getTime()); // Return a copy
  }

  /**
   * Sets the start date for fetching transactions.
   * The date is normalized to the beginning of the day and stored in localStorage.
   * After setting, it triggers `autoUpdateDataIfNeeded` to refresh data based on the new date.
   * @param date The new start date to configure.
   */
  public setConfiguredStartDate(date: Date): void {
    const newStartDate = new Date(date.getTime());
    newStartDate.setHours(0, 0, 0, 0); // Normalize to start of the day
    this.configuredStartDate = newStartDate;
    localStorage.setItem(LS_CONFIGURED_START_DATE_KEY, this.configuredStartDate.toISOString());
    console.log('Configured start date set to:', this.configuredStartDate);
    // Trigger data refresh with the new date, forcing an update.
    this.autoUpdateDataIfNeeded(true).catch(e => console.error("Error auto-updating after date set:", e));
  }

  /**
   * Retrieves the last recorded update period from Dexie.
   * This period indicates the date range of data previously fetched.
   * @returns A Promise resolving to the `UpdatePeriod` object or `undefined` if not found or error.
   */
  private async getLatestUpdatePeriod(): Promise<UpdatePeriod | undefined> {
    try {
      return await db.updatePeriods.get(DEFAULT_FETCH_PERIOD_ID);
    } catch (error) {
      console.error("Error getting latest update period from Dexie:", error);
      return undefined;
    }
  }

  /**
   * Saves the given date range as the latest update period in Dexie.
   * This marks the period for which data has been successfully fetched and stored.
   * @param startDate The start date of the fetched data period.
   * @param endDate The end date of the fetched data period.
   */
  private async saveUpdatePeriod(startDate: Date, endDate: Date): Promise<void> {
    const period: UpdatePeriod = {
      id: DEFAULT_FETCH_PERIOD_ID,
      startDate: Math.floor(startDate.getTime() / 1000), // Store as Unix timestamp (seconds)
      endDate: Math.floor(endDate.getTime() / 1000),
      lastFetched: Math.floor(Date.now() / 1000) // Record when this save occurred
    };
    try {
      await db.updatePeriods.put(period);
      console.log('Update period saved to Dexie:', period);
    } catch (error) {
      console.error("Error saving update period to Dexie:", error);
    }
  }

  /**
   * Automatically updates financial data if needed, based on stored access details,
   * configured start date, and the last fetched data period.
   * If `forceUpdate` is true, data is fetched regardless of the last update time.
   * If no access details are stored, it attempts to load data from the local DB for offline viewing.
   * @param forceUpdate If true, forces a data refresh from the API.
   */
  public async autoUpdateDataIfNeeded(forceUpdate: boolean): Promise<void> {
    // If no access details, try to load from DB for offline view and then return.
    if (!this._hasStoredAccessDetailsSubject.value) {
      this.errorMessageSubject.next("No access details. Please provide a setup token to fetch new data.");
      await this.loadAccountsFromDB();
      await this.loadTransactionsFromDB();
      return;
    }

    this.isLoadingSubject.next(true); // Indicate loading started

    // Determine the target start date for fetching data (normalized to start of day).
    const targetStartDate = new Date(this.configuredStartDate);
    targetStartDate.setHours(0, 0, 0, 0);

    const today = new Date();
    const beginningOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const latestPeriod = await this.getLatestUpdatePeriod();

    // Logic to decide if a fetch is necessary
    if (!forceUpdate && latestPeriod) {
      const storedStartDate = new Date(latestPeriod.startDate * 1000);
      const storedEndDate = new Date(latestPeriod.endDate * 1000); // The end date covered by the last fetch

      const coversTargetStart = storedStartDate.getTime() <= targetStartDate.getTime();
      // Data is recent enough if it covers up to the beginning of today.
      const isDataRecentEnough = storedEndDate.getTime() >= beginningOfToday.getTime();

      if (coversTargetStart && isDataRecentEnough) {
        console.log('Local data is recent and covers configured range. Loading from DB.');
        await this.loadAccountsFromDB();
        await this.loadTransactionsFromDB();
        this.isLoadingSubject.next(false); // Loading finished
        return; // No API fetch needed
      } else {
        console.log('Data is outdated or does not cover the full configured range. Fetching new data. Stored Period End:', storedEndDate, 'Target Start:', targetStartDate, 'Is Recent:', isDataRecentEnough, 'Covers Target:', coversTargetStart);
      }
    } else if (forceUpdate) {
      console.log('Force update requested. Fetching new data.');
    } else {
      console.log('No existing update period found or initial load with missing data. Fetching new data.');
    }

    // Fetch data from SimpleFin API.
    // The `fetchDataFromSimpleFin` method handles its own loading state and error messages.
    this.fetchDataFromSimpleFin(targetStartDate.toISOString().split('T')[0])
      .subscribe({
        next: () => {
          // On successful fetch, save the new update period.
          this.saveUpdatePeriod(targetStartDate, new Date()); // End date is now
          console.log('Data fetch successful as part of auto-update; update period recorded.');
        },
        error: (err) => {
            // Error is already handled by fetchDataFromSimpleFin's catchError and isLoading by finalize.
            console.error('Error during auto-update fetch operation:', err);
        }
        // isLoadingSubject.next(false) is handled by finalize in fetchDataFromSimpleFin
      });
  }

  /**
   * Decodes a Base64 encoded setup token (potential SimpleFin claim URL).
   * @param setupToken The Base64 encoded setup token.
   * @returns The decoded URL string, or null if decoding fails.
   */
  private decodeSetupToken(setupToken: string): string | null {
    try {
      const decodedUrl = atob(setupToken);
      this.claimUrlForDisplay = decodedUrl; // Store for display/debugging
      return decodedUrl;
    } catch (e) {
      this.claimUrlForDisplay = ''; // Clear if invalid
      this.errorMessageSubject.next('Invalid Base64 Setup Token.');
      console.error("Error decoding setup token:", e);
      return null;
    }
  }

  /**
   * Extracts API base URL and authentication details from a raw SimpleFin access URL.
   * Saves these details to localStorage if successfully parsed.
   * @param rawAccessUrl The raw access URL string provided by SimpleFin (e.g., after a claim).
   * @returns True if parsing and storage were successful, false otherwise.
   */
  private extractAndStoreAccessDetails(rawAccessUrl: string): boolean {
    try {
      const url = new URL(rawAccessUrl);
      const username = url.username;
      const password = url.password;

      // Construct the base URL (scheme, host, path, without user/pass or query params/fragment)
      this.parsedBaseUrl = `${url.protocol}//${url.host}${url.pathname}`;
      this.rawAccessUrl = rawAccessUrl; // Store the original raw URL

      // Determine authentication header if username is present
      if (username) {
        const credentialsToEncode = password ? `${username}:${password}` : username;
        this.dataAuthHeader = `Basic ${btoa(credentialsToEncode)}`;
      } else {
        this.dataAuthHeader = null; // No Basic Auth if no username in URL
      }

      this.saveAccessDetailsToStorage(); // Save parsed details and update BehaviorSubjects
      return true;
    } catch (e: any) {
      this.errorMessageSubject.next(`Invalid Access URL format: ${rawAccessUrl}. Error: ${e.message}`);
      console.error("Error parsing access URL:", e);
      this.parsedBaseUrl = ''; // Clear any partially parsed data
      this.dataAuthHeader = null;
      this.saveAccessDetailsToStorage(); // Save cleared state
      return false;
    }
  }

  /**
   * Claims a SimpleFin access URL using a setup token, then fetches initial financial data.
   * This involves:
   * 1. Decoding the setup token.
   * 2. POSTing to the decoded URL to get a SimpleFin access URL.
   * 3. Parsing and storing the access URL and authentication details.
   * 4. Triggering an initial data fetch using the configured start date.
   * 5. Recording the successfully fetched data period.
   * @param setupToken The Base64 encoded setup token from SimpleFin.
   * @returns An Observable that completes when the process is finished, or errors if any step fails.
   */
  public claimAndFetchData(setupToken: string): Observable<void> {
    if (!setupToken) {
      this.errorMessageSubject.next('Setup Token is required.');
      return throwError(() => new Error('Setup Token is required.'));
    }

    this.isLoadingSubject.next(true);
    this.errorMessageSubject.next(null); // Clear previous errors
    this.accountsSubject.next([]);      // Clear previous data
    this.transactionsSubject.next([]);

    // 1. Decode the setup token
    const claimUrl = this.decodeSetupToken(setupToken);
    if (!claimUrl) {
      this.isLoadingSubject.next(false);
      return throwError(() => new Error('Invalid Base64 Setup Token.'));
    }

    // 2. POST to the decoded URL to get a SimpleFin access URL
    return this.http.post(claimUrl, null, { // Body is null, Content-Length: 0 for SF claim
      headers: new HttpHeaders({ 'Content-Length': '0' }),
      responseType: 'text' // Expecting the access URL as plain text
    }).pipe(
      switchMap(accessUrlResponse => {
        if (!accessUrlResponse) {
          return throwError(() => new Error('Failed to retrieve Access URL (empty response from claim).'));
        }

        // 3. Parse and store the access URL and authentication details
        if (!this.extractAndStoreAccessDetails(accessUrlResponse)) {
          // Error message is set by extractAndStoreAccessDetails
          return throwError(() => new Error('Failed to parse or store access details from claimed URL.'));
        }

        // 4. Trigger initial data fetch using the configured start date
        const startDateForFetch = this.configuredStartDate.toISOString().split('T')[0];
        return this.fetchDataFromSimpleFin(startDateForFetch).pipe(
          // 5. Record the successfully fetched data period
          tap(() => this.saveUpdatePeriod(this.configuredStartDate, new Date()))
        );
      }),
      tap(() => {
        // If all successful, clear any transient error messages.
        this.errorMessageSubject.next(null);
      }),
      catchError(err => {
        // Ensure error message is set from the error or a generic one.
        this.errorMessageSubject.next(err.message || 'Failed to claim and fetch data.');
        console.error("Claim and fetch process error:", err);
        this.isLoadingSubject.next(false); // Ensure loading is stopped on error
        return throwError(() => err); // Re-throw the error for the subscriber
      }),
      finalize(() => {
        // Note: isLoadingSubject is set to false by fetchDataFromSimpleFin's finalize,
        // or by catchError here if an earlier step fails.
        // If claim itself fails before fetchDataFromSimpleFin, ensure isLoading is false.
        if (this.isLoadingSubject.value && !this.parsedBaseUrl) { // Check if it's an early error
            this.isLoadingSubject.next(false);
        }
      })
    );
  }

  /**
   * Prepares HTTP headers and parameters for a SimpleFin API request.
   * @param startDateForAPI Optional start date string (YYYY-MM-DD) to fetch data from.
   *                        If provided, it's converted to a Unix timestamp for the API.
   * @returns An object containing `HttpHeaders` and `HttpParams`, or null if `startDateForAPI` is invalid.
   */
  private prepareApiRequest(startDateForAPI?: string): { headers: HttpHeaders, params: HttpParams } | null {
    let requestHeaders = new HttpHeaders();
    if (this.dataAuthHeader) {
      requestHeaders = requestHeaders.set('Authorization', this.dataAuthHeader);
    }

    let httpParams = new HttpParams();
    if (startDateForAPI) {
      // Parse YYYY-MM-DD as UTC start of day, then convert to Unix timestamp (seconds)
      const dateObj = new Date(startDateForAPI + "T00:00:00Z");
      if (!isNaN(dateObj.getTime())) {
          const unixTimestampSeconds = Math.floor(dateObj.getTime() / 1000);
          httpParams = httpParams.set('start-date', unixTimestampSeconds.toString());
      } else {
          this.errorMessageSubject.next('Invalid Start Date format provided for API call.');
          console.error('Invalid Start Date for API call:', startDateForAPI);
          return null; // Indicate failure
      }
    }
    return { headers: requestHeaders, params: httpParams };
  }

  /**
   * Handles the response from the SimpleFin API `/accounts` endpoint.
   * This includes:
   * - Clearing local DB stores if it's a full refresh.
   * - Processing the raw API data (calculating running balances, etc.).
   * - Saving the processed accounts and transactions to Dexie.
   * - Updating the `accountsSubject` and `transactionsSubject` BehaviorSubjects.
   * - Setting error messages if the API response contains errors or is malformed.
   * @param response The `SimpleFinResponse` object from the API.
   * @param isFullRefresh True if this API call was intended to be a full refresh (e.g., `startDateForAPI` was provided).
   */
  private async handleApiResponse(response: SimpleFinResponse, isFullRefresh: boolean): Promise<void> {
    if (response && response.accounts) {
      // If it's a full refresh (typically when a start date is provided), clear old data first.
      if (isFullRefresh) {
          try {
            await Promise.all([db.transactions.clear(), db.accounts.clear()]);
            console.log("Cleared existing transactions and accounts from DB before new full fetch.");
          } catch (dbError) {
            console.error("Error clearing DB stores during full refresh:", dbError);
            // Proceed with processing new data, but log the error.
            this.errorMessageSubject.next('Error clearing local data before refresh. New data may be appended to old.');
          }
      }

      // Process raw data (adds running balances, etc.)
      const { accounts, processedTransactions } = this.processRawData(response);

      // Save processed data to Dexie and update BehaviorSubjects
      await this.saveAccountsToDB(accounts);
      this.accountsSubject.next(accounts);

      await this.saveTransactionsToDB(processedTransactions);
      this.transactionsSubject.next(processedTransactions);

      this.errorMessageSubject.next(null); // Clear any previous errors on successful processing
    } else if (response && response.errors && response.errors.length > 0) {
      // Handle API-reported errors
      const errorMessages = response.errors.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join(', ');
      this.errorMessageSubject.next(`API Errors: ${errorMessages}`);
      this.accountsSubject.next([]); // Clear data on error
      this.transactionsSubject.next([]);
    } else {
      // Handle empty or unexpected API response
      this.errorMessageSubject.next('Empty or unexpected response from SimpleFin API.');
      this.accountsSubject.next([]);
      this.transactionsSubject.next([]);
    }
  }

  /**
   * Fetches financial data (accounts and transactions) from the SimpleFin API.
   * Uses the stored `parsedBaseUrl` and `dataAuthHeader`.
   * An optional `startDateForAPI` can be provided to fetch data from a specific date onwards.
   * If `startDateForAPI` is provided, it's treated as a full refresh, potentially clearing old data.
   * @param startDateForAPI Optional. A string in 'YYYY-MM-DD' format to fetch data from this date.
   * @returns An Observable that completes when data is fetched and processed, or errors if the fetch fails.
   */
  public fetchDataFromSimpleFin(startDateForAPI?: string): Observable<void> {
    if (!this.parsedBaseUrl) {
      this.errorMessageSubject.next('No Access URL available to fetch data.');
      return throwError(() => new Error('No Access URL available.'));
    }

    this.isLoadingSubject.next(true);
    this.errorMessageSubject.next(null); // Clear previous errors

    // Prepare HTTP headers and parameters
    const requestConfig = this.prepareApiRequest(startDateForAPI);
    if (!requestConfig) { // Handles invalid startDateForAPI
      this.isLoadingSubject.next(false);
      return throwError(() => new Error('Failed to prepare API request due to invalid start date.'));
    }

    // Make the HTTP GET request to SimpleFin API
    return this.http.get<SimpleFinResponse>(`${this.parsedBaseUrl}/accounts`, {
      headers: requestConfig.headers,
      params: requestConfig.params
    }).pipe(
      // Process the successful response
      switchMap(async response => this.handleApiResponse(response, !!startDateForAPI)),
      map(() => undefined), // Transform the Promise<void> from handleApiResponse back to void for Observable
      catchError(err => {
        // Handle HTTP errors or errors from handleApiResponse
        this.errorMessageSubject.next(err.message || 'Failed to fetch data from SimpleFin.');
        console.error("Fetch data error:", err);
        // Clear data subjects on error to avoid displaying stale/partial data
        this.accountsSubject.next([]);
        this.transactionsSubject.next([]);
        return throwError(() => err); // Re-throw the error
      }),
      finalize(() => {
        // Ensure loading indicator is turned off when the observable completes or errors
        this.isLoadingSubject.next(false);
      })
    );
  }

  /**
   * Processes raw account and transaction data from the SimpleFin API response.
   * Key operations:
   * - Converts account balance strings to numbers.
   * - For each account's transactions:
   *   - Sorts transactions in descending order by posted date (most recent first). This is crucial
   *     because SimpleFin provides the current balance, and we need to work backwards from it.
   *   - Calculates `balanceBefore` and `balanceAfter` for each transaction by iterating
   *     backwards from the current account balance. The `balanceAfter` a transaction is the
   *     `runningBalance` before processing that transaction. The `balanceBefore` is then
   *     `runningBalance - transaction.amount`. The `runningBalance` is then updated to `balanceBefore`
   *     for the next (older) transaction.
   * - Aggregates all processed transactions from all accounts.
   * - Sorts all aggregated transactions globally by posted date (most recent first).
   * @param data The raw `SimpleFinResponse` from the API.
   * @returns An object containing an array of `Account` objects (with numeric balances) and
   *          an array of all `ProcessedTransaction` objects (with calculated running balances).
   */
  private processRawData(data: SimpleFinResponse): { accounts: Account[], processedTransactions: ProcessedTransaction[] } {
    const allProcessedTransactions: ProcessedTransaction[] = [];

    // Process each account from the API response
    const finalAccounts: Account[] = data.accounts.map(account => {
      const accBalanceNum = parseFloat(account.balance);
      // Use available balance if present, otherwise fall back to current balance
      const accAvailableBalanceNum = account['available-balance'] ? parseFloat(account['available-balance']) : accBalanceNum;

      if (account.transactions && account.transactions.length > 0) {
        // Start with the current balance of the account for running balance calculation.
        let runningBalance = accBalanceNum;

        // Sort transactions for this account: most recent first (descending by posted date).
        // This allows calculating `balanceBefore` by subtracting amounts from the current balance.
        // Use `posted` date primarily, fallback to `transacted_at` if `posted` is missing.
        const descRawTransactions = [...account.transactions].sort((a, b) =>
          (b.posted ?? b.transacted_at ?? 0) - (a.posted ?? a.transacted_at ?? 0)
        );

        // Iterate through sorted transactions (newest to oldest) to calculate running balances.
        descRawTransactions.forEach(rawTx => {
          const amountNum = parseFloat(rawTx.amount); // Transaction amount as a number

          // `balanceAfter` this transaction is the `runningBalance` *before* this transaction is accounted for.
          const balanceAfter = runningBalance;
          // `balanceBefore` this transaction is `balanceAfter - amount`.
          const balanceBefore = runningBalance - amountNum;

          allProcessedTransactions.push({
            ...rawTx,
            accountId: account.id, // Link transaction to its account
            orgName: account.org.name,
            accountName: account.name,
            currency: account.currency,
            amountNum: amountNum,
            balanceBefore: balanceBefore, // Calculated historical balance
            balanceAfter: balanceAfter,   // Calculated historical balance
          });

          // Update `runningBalance` to be the balance *before* this transaction, for the next older transaction.
          runningBalance = balanceBefore;
        });
      }
      // Return the account with numeric balances and its original transactions array (as per model).
      // The processed transactions are collected in `allProcessedTransactions`.
      return { ...account, balanceNum: accBalanceNum, availableBalanceNum: accAvailableBalanceNum, transactions: account.transactions };
    });

    // Sort all collected transactions globally by date (most recent first) for consistent display.
    allProcessedTransactions.sort((a, b) => (b.posted ?? b.transacted_at ?? 0) - (a.posted ?? a.transacted_at ?? 0));
    return { accounts: finalAccounts, processedTransactions: allProcessedTransactions };
  }

  /**
   * Saves an array of processed transactions to the local Dexie database.
   * Transactions are converted to `StorableTransaction` format, which includes a `compoundId`.
   * @param transactions Array of `ProcessedTransaction` objects to save.
   */
  private async saveTransactionsToDB(transactions: ProcessedTransaction[]): Promise<void> {
    if (!transactions || transactions.length === 0) return;

    // Map ProcessedTransaction to StorableTransaction, creating a compound ID for Dexie.
    const storableTxs: StorableTransaction[] = transactions.map(tx => {
      if (!tx.accountId) {
          // This should ideally not happen if processRawData populates accountId correctly.
          console.warn("Transaction missing accountId, cannot form reliable compoundId:", tx);
          const accountIdentifier = `${tx.orgName}-${tx.accountName}`; // Fallback identifier
          return { ...tx, compoundId: `${accountIdentifier}-${tx.id}` };
      }
      return {
        ...tx,
        compoundId: `${tx.accountId}-${tx.id}` // Preferred compound ID
      };
    });

    try {
      // Use bulkPut for efficient add/update of multiple records.
      await db.transactions.bulkPut(storableTxs);
      console.log(`${storableTxs.length} transactions saved/updated in Dexie.`);
    } catch (error) {
      console.error('Error saving transactions to Dexie:', error);
      this.errorMessageSubject.next('Failed to save transactions to local database.');
    }
  }

  /**
   * Loads all transactions from the local Dexie database, ordered by posted date (descending).
   * Updates the `transactionsSubject` with the loaded data.
   * Manages error messages, careful not to overwrite existing unrelated error messages.
   */
  public async loadTransactionsFromDB(): Promise<void> {
    try {
      // Retrieve transactions, ordered by 'posted' date, newest first.
      const storedTxs = await db.transactions.orderBy('posted').reverse().toArray();
      // Map StorableTransaction back to ProcessedTransaction (if needed, though types are compatible here).
      const loadedTransactions: ProcessedTransaction[] = storedTxs.map(stx => {
        const { compoundId, ...tx } = stx; // Remove compoundId if not part of ProcessedTransaction model
        return tx as ProcessedTransaction;
      });
      this.transactionsSubject.next(loadedTransactions);

      // Clear error message only if it's not about accounts failing, to avoid masking other errors.
      const currentError = this.errorMessageSubject.value;
      if (!currentError || !currentError.includes('accounts')) {
          this.errorMessageSubject.next(null);
      }
      console.log(`${loadedTransactions.length} transactions loaded from Dexie.`);
    } catch (error) {
      console.error('Error loading transactions from Dexie:', error);
      const currentError = this.errorMessageSubject.value;
      const newError = 'Failed to load transactions from local database.';
      // Append new error or set if no current error.
      this.errorMessageSubject.next(currentError ? `${currentError} ${newError}` : newError);
      this.transactionsSubject.next([]); // Clear data on error
    }
  }

  /**
   * Saves an array of accounts to the local Dexie database.
   * Accounts are stored as `StorableAccount` (currently identical to `Account` but allows future divergence).
   * @param accounts Array of `Account` objects to save.
   */
  private async saveAccountsToDB(accounts: Account[]): Promise<void> {
    if (!accounts || accounts.length === 0) return;

    // Map Account to StorableAccount (direct spread as they are compatible).
    const storableAccounts: StorableAccount[] = accounts.map(acc => ({
        ...acc
    }));

    try {
      // Use bulkPut for efficient add/update. Assumes `Account.id` is the primary key.
      await db.accounts.bulkPut(storableAccounts);
      console.log(`${storableAccounts.length} accounts saved/updated in Dexie.`);
    } catch (error) {
      console.error('Error saving accounts to Dexie:', error);
      this.errorMessageSubject.next('Failed to save accounts to local database.');
    }
  }

  /**
   * Loads all accounts from the local Dexie database.
   * Updates the `accountsSubject` with the loaded data.
   * Manages error messages.
   */
  public async loadAccountsFromDB(): Promise<void> {
    try {
      const storedAccounts = await db.accounts.toArray();
      this.accountsSubject.next(storedAccounts as Account[]); // Cast if StorableAccount differs from Account
      // Error message is typically managed by the calling context (e.g., autoUpdateDataIfNeeded)
      console.log(`${storedAccounts.length} accounts loaded from Dexie.`);
    } catch (error) {
      console.error('Error loading accounts from Dexie:', error);
      const currentError = this.errorMessageSubject.value;
      const newError = 'Failed to load accounts from local database.';
      // Append new error or set if no current error.
      this.errorMessageSubject.next(currentError ? `${currentError} ${newError}` : newError);
      this.accountsSubject.next([]); // Clear data on error
    }
  }
}

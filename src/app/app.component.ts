import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UnixToDatePipe } from './unix-to-date.pipe';

// Define localStorage keys
const LS_RAW_ACCESS_URL_KEY = 'sfin_raw_access_url';
const LS_PARSED_BASE_URL_KEY = 'sfin_parsed_base_url';
const LS_AUTH_HEADER_KEY = 'sfin_auth_header';

// --- Data Interfaces ---
interface Org {
  domain: string;
  name: string;
  'sfin-url': string;
  url: string;
  id: string;
}

interface Transaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  amountNum?: number;
  balanceBefore?: number;
  balanceAfter?: number;
}

// New interface for the flattened transaction list
interface ProcessedTransaction extends Transaction {
  orgName: string;
  accountName: string;
  accountCurrency: string; // Needed for currency pipe in the consolidated table
}

interface Account {
  org: Org;
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions: Transaction[];
  holdings: any[];
  balanceNum?: number;
  availableBalanceNum?: number;
}

interface SimpleFinResponse {
  errors: any[];
  accounts: Account[];
}
// --- End Data Interfaces ---

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UnixToDatePipe
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  setupToken: string = '';
  claimUrl: string = '';
  rawAccessUrl: string = '';
  parsedBaseUrl: string = '';

  public accountsData: SimpleFinResponse | null = null;
  public allTransactions: ProcessedTransaction[] = []; // For the consolidated table

  errorMessage: string | null = null;
  isLoading: boolean = false;
  startDate: string = '';

  dataAuthHeader: string | null = null;
  hasStoredAccessDetails: boolean = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadAccessDetailsFromStorage();
  }

  loadAccessDetailsFromStorage(): void {
    const storedRawUrl = localStorage.getItem(LS_RAW_ACCESS_URL_KEY);
    const storedParsedUrl = localStorage.getItem(LS_PARSED_BASE_URL_KEY);
    const storedAuthHeader = localStorage.getItem(LS_AUTH_HEADER_KEY);

    if (storedParsedUrl && (storedAuthHeader || !storedRawUrl?.includes('@'))) {
      this.rawAccessUrl = storedRawUrl || '';
      this.parsedBaseUrl = storedParsedUrl;
      this.dataAuthHeader = storedAuthHeader || null;
      this.hasStoredAccessDetails = true;
    } else {
      this.hasStoredAccessDetails = false;
    }
  }

  saveAccessDetailsToStorage(): void {
    if (this.parsedBaseUrl) {
      localStorage.setItem(LS_RAW_ACCESS_URL_KEY, this.rawAccessUrl);
      localStorage.setItem(LS_PARSED_BASE_URL_KEY, this.parsedBaseUrl);
      if (this.dataAuthHeader) {
        localStorage.setItem(LS_AUTH_HEADER_KEY, this.dataAuthHeader);
      } else {
        localStorage.removeItem(LS_AUTH_HEADER_KEY);
      }
      this.hasStoredAccessDetails = true;
    }
  }

  clearStoredAccessUrl(): void {
    localStorage.removeItem(LS_RAW_ACCESS_URL_KEY);
    localStorage.removeItem(LS_PARSED_BASE_URL_KEY);
    localStorage.removeItem(LS_AUTH_HEADER_KEY);
    this.rawAccessUrl = '';
    this.parsedBaseUrl = '';
    this.dataAuthHeader = null;
    this.accountsData = null;
    this.allTransactions = []; // Clear consolidated transactions
    this.claimUrl = '';
    this.errorMessage = 'Stored access details cleared. Enter a new token if needed.';
    this.hasStoredAccessDetails = false;
  }

  private processAccountsData(data: SimpleFinResponse): SimpleFinResponse {
    const processedTransactions: ProcessedTransaction[] = [];

    data.accounts.forEach(account => {
      account.balanceNum = parseFloat(account.balance);
      account.availableBalanceNum = account['available-balance'] ? parseFloat(account['available-balance']) : account.balanceNum;

      if (account.transactions && account.transactions.length > 0) {
        account.transactions.forEach(tx => {
          tx.amountNum = parseFloat(tx.amount);
        });

        const descTransactions = [...account.transactions].sort((a, b) => (b.posted ?? b.transacted_at ?? 0) - (a.posted ?? a.transacted_at ?? 0));
        let runningBalance = account.balanceNum as number;

        descTransactions.forEach(tx => {
          tx.balanceAfter = runningBalance;
          tx.balanceBefore = runningBalance - (tx.amountNum as number);
          runningBalance = tx.balanceBefore;

          // Add to the consolidated list
          processedTransactions.push({
            ...tx,
            orgName: account.org.name,
            accountName: account.name,
            accountCurrency: account.currency
          });
        });
        // We don't need to re-sort account.transactions here anymore if not displayed per account
      }
    });

    // Sort all transactions chronologically by posted date for display
    this.allTransactions = processedTransactions.sort((a, b) => (a.posted ?? a.transacted_at ?? 0) - (b.posted ?? b.transacted_at ?? 0));
    return data; // Return original data structure (with parsed numbers for account summary)
  }

  private fetchData(): void {
    if (!this.parsedBaseUrl) {
      this.errorMessage = "No Access URL available to fetch data.";
      this.isLoading = false;
      return;
    }
    this.isLoading = true;
    this.accountsData = null;
    this.allTransactions = []; // Clear previous consolidated transactions
    this.errorMessage = null;

    let requestHeaders = new HttpHeaders();
    if (this.dataAuthHeader) {
      requestHeaders = requestHeaders.set('Authorization', this.dataAuthHeader);
    }

    let httpParams = new HttpParams();
    if (this.startDate) {
      const dateObj = new Date(this.startDate + 'T00:00:00Z');
      if (!isNaN(dateObj.getTime())) {
        const unixTimestampSeconds = Math.floor(dateObj.getTime() / 1000);
        httpParams = httpParams.set('start-date', unixTimestampSeconds.toString());
      } else {
        this.errorMessage = 'Invalid Start Date format. Please use YYYY-MM-DD.';
        this.isLoading = false;
        return;
      }
    }

    this.http.get<SimpleFinResponse>(`${this.parsedBaseUrl}/accounts`, {
      headers: requestHeaders,
      params: httpParams
    }).pipe(
      catchError(error => {
        this.errorMessage = `Error fetching accounts: ${error.message || 'Unknown error'}. Check console.`;
        console.error("Error fetching accounts:", error);
        return of(null);
      })
    ).subscribe(response => {
      if (response && response.accounts) {
        // processAccountsData now populates this.allTransactions as a side effect
        this.accountsData = this.processAccountsData(response);
      } else if (response && response.errors && response.errors.length > 0) {
        this.errorMessage = `Errors from API: ${response.errors.map(e => e.message || JSON.stringify(e)).join(', ')}`;
      } else if (!response && !this.errorMessage) {
        this.errorMessage = "Received an empty or unexpected response from the server.";
      }
      this.isLoading = false;
    });
  }

  async runQuery() {
    this.isLoading = true;
    this.errorMessage = null;
    this.accountsData = null;
    this.allTransactions = []; // Clear consolidated transactions

    if (this.hasStoredAccessDetails && this.parsedBaseUrl) {
      this.fetchData();
      return;
    }

    this.claimUrl = '';
    this.rawAccessUrl = '';
    this.parsedBaseUrl = '';
    this.dataAuthHeader = null;

    if (!this.setupToken) {
      this.errorMessage = 'Please enter a Setup Token (no stored access URL found).';
      this.isLoading = false;
      return;
    }

    try {
      this.claimUrl = atob(this.setupToken);
    } catch (e) {
      this.errorMessage = 'Invalid Base64 Setup Token.';
      this.isLoading = false;
      return;
    }

    this.http.post(this.claimUrl, null, {
      headers: new HttpHeaders({ 'Content-Length': '0' }),
      responseType: 'text'
    }).pipe(
      catchError(error => {
        this.errorMessage = `Error claiming Access URL: ${error.message || 'Unknown error'}. Check console.`;
        console.error("Error claiming Access URL:", error);
        this.isLoading = false;
        return of(null);
      })
    ).subscribe(accessUrlResponse => {
      if (accessUrlResponse) {
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
          
          this.saveAccessDetailsToStorage();
          this.fetchData();

        } catch (e: any) {
          this.errorMessage = `Invalid Access URL format: ${this.rawAccessUrl}. Error: ${e.message}`;
          console.error("Error parsing Access URL:", e);
          this.isLoading = false;
        }
      } else {
        if (!this.errorMessage) {
            this.errorMessage = 'Failed to retrieve Access URL (empty response from claim).';
        }
        this.isLoading = false;
      }
    });
  }
}

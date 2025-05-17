// src/app/pages/dashboard/dashboard.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimpleFinDataService } from '../../services/simplefin-data.service';
import { BudgetConfigService } from '../../services/budget-config.service';
import { UiStateService } from '../../services/ui-state.service';
import { RuleEngineService } from '../../services/rule-engine.service'; // Import RuleEngineService
import { Account, ProcessedTransaction, Bucket, Rule } from '../../models/budget.model'; // Ensure Rule is imported
import { UnixToDatePipe } from '../../unix-to-date.pipe';

interface CategorizedTransaction extends ProcessedTransaction {
  bucketId?: string;
  bucketName?: string;
}
interface BucketWithTransactions extends Bucket {
  transactions: CategorizedTransaction[];
  totalAmount: number;
  expanded?: boolean; // For individual bucket expansion
}

// Define constants for UI state IDs
const UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED = 'dashboardAccountSummaryFolded';
const UI_DASHBOARD_UNCATEGORIZED_EXPANDED = 'dashboardUncategorizedExpanded';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, UnixToDatePipe, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  buckets: Bucket[] = [];
  accountSummary: Account[] = [];
  allTransactions: ProcessedTransaction[] = [];

  categorizedBuckets: BucketWithTransactions[] = [];
  isLoading: boolean = false;
  errorMessage: string | null = null;
  hasStoredAccessDetails: boolean = false;

  // Foldable state properties
  accountSummaryFolded: boolean = false;

  private subscriptions = new Subscription();

  constructor(
    private dataService: SimpleFinDataService,
    private budgetConfigService: BudgetConfigService,
    private uiStateService: UiStateService,
    private ruleEngine: RuleEngineService // Inject RuleEngineService
  ) {}

  async ngOnInit(): Promise<void> {
    this.buckets = this.budgetConfigService.getBuckets();

    this.accountSummaryFolded = await this.uiStateService.getFoldableState(UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED, false);

    this.subscriptions.add(this.dataService.accounts$.subscribe(accs => {
      this.accountSummary = accs;
      if (this.allTransactions.length > 0) { this.categorizeTransactions(); }
    }));
    this.subscriptions.add(this.dataService.transactions$.subscribe(txs => {
      this.allTransactions = txs;
      this.categorizeTransactions();
    }));
    this.subscriptions.add(this.dataService.isLoading$.subscribe(loading => this.isLoading = loading));
    this.subscriptions.add(this.dataService.errorMessage$.subscribe(err => this.errorMessage = err));
    this.subscriptions.add(
      this.dataService.hasStoredAccessDetails$.subscribe(
        (hasDetails: boolean) => {
          this.hasStoredAccessDetails = hasDetails;
          if (!hasDetails) {
            this.allTransactions = [];
            this.accountSummary = [];
            this.categorizeTransactions();
          }
          // If details are present and transactions are empty, service constructor should initiate load/update
        }
      )
    );
  }

  async categorizeTransactions(): Promise<void> {
    if (!this.allTransactions || !this.buckets) {
        this.categorizedBuckets = (this.buckets || []).map(b => ({ ...b, transactions: [], totalAmount: 0, expanded: false }));
        return;
    }
    // Ensure Uncategorized starts folded (or its persisted state)
    const uncategorizedInitialExpansion = await this.uiStateService.getFoldableState(UI_DASHBOARD_UNCATEGORIZED_EXPANDED, false);


    if (this.allTransactions.length === 0 || this.buckets.length === 0) {
        this.categorizedBuckets = this.buckets.map(b => ({ ...b, transactions: [], totalAmount: 0, expanded: false }));
        // Add empty uncategorized if no buckets but transactions exist (or just handle normally)
        if (this.allTransactions.length > 0 && this.buckets.length === 0) {
            this.categorizedBuckets.push({
                id: 'uncategorized', name: 'Uncategorized Transactions', priority: 9999, rules: [],
                transactions: [...this.allTransactions], // All transactions go here
                expanded: uncategorizedInitialExpansion,
                totalAmount: this.allTransactions.reduce((sum, t) => sum + (t.amountNum || 0), 0)
            });
        }
        return;
    }


    const tempCategorizedTransactions: CategorizedTransaction[] = this.allTransactions.map(tx => ({...tx}));
    const assignedTransactionIds = new Set<string>();
    const newCategorizedBuckets: BucketWithTransactions[] = []; // Build a new array

    const sortedBuckets = [...this.buckets].sort((a, b) => a.priority - b.priority);

    for (const bucket of sortedBuckets) {
      const bucketTransactions: CategorizedTransaction[] = [];
      let bucketTotal = 0;
      const initialExpandedState = await this.uiStateService.getFoldableState(`bucket_${bucket.id}_expanded`, false);

      for (const tx of tempCategorizedTransactions) {
        if (assignedTransactionIds.has(tx.id)) continue;

        let matchesAnyActiveRuleInBucket = false;
        for (const bucketRule of bucket.rules) {
          if (bucketRule.isActive) {
            const ruleDefinition = this.budgetConfigService.getRuleById(bucketRule.ruleId);
            if (ruleDefinition && this.ruleEngine.evaluateTransactionAgainstRule(tx, ruleDefinition)) {
              matchesAnyActiveRuleInBucket = true;
              break;
            }
          }
        }
        
        if (matchesAnyActiveRuleInBucket) {
          const categorizedTx = { ...tx, bucketId: bucket.id, bucketName: bucket.name };
          bucketTransactions.push(categorizedTx);
          assignedTransactionIds.add(tx.id);
          bucketTotal += tx.amountNum || 0;
        }
      }
      newCategorizedBuckets.push({ ...bucket, transactions: bucketTransactions, totalAmount: bucketTotal, expanded: initialExpandedState });
    }

    const uncategorizedTransactions = tempCategorizedTransactions.filter(tx => !assignedTransactionIds.has(tx.id));
    if (uncategorizedTransactions.length > 0) {
      newCategorizedBuckets.push({
        id: 'uncategorized', name: 'Uncategorized Transactions', priority: 9999, rules: [],
        transactions: uncategorizedTransactions.map(tx => ({...tx})), // Ensure they are CategorizedTransaction type
        expanded: uncategorizedInitialExpansion,
        totalAmount: uncategorizedTransactions.reduce((sum, t) => sum + (t.amountNum || 0), 0)
      });
    }
    this.categorizedBuckets = newCategorizedBuckets;
  }

  toggleAccountSummary(): void {
    this.accountSummaryFolded = !this.accountSummaryFolded;
    this.uiStateService.setFoldableState(UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED, this.accountSummaryFolded);
  }

  toggleTransactions(bucket: BucketWithTransactions): void {
    bucket.expanded = !bucket.expanded;
    const bucketStateId = bucket.id === 'uncategorized' ? UI_DASHBOARD_UNCATEGORIZED_EXPANDED : `bucket_${bucket.id}_expanded`;
    this.uiStateService.setFoldableState(bucketStateId, bucket.expanded as boolean);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}

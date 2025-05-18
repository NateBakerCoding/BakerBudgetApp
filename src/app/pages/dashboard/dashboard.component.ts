// src/app/pages/dashboard/dashboard.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimpleFinDataService } from '../../services/simplefin-data.service';
import { BudgetConfigService } from '../../services/budget-config.service';
import { UiStateService } from '../../services/ui-state.service';
import { RuleEngineService } from '../../services/rule-engine.service';
import { Account, ProcessedTransaction, Bucket, Rule, BucketGoal, GoalType, GoalTimePeriodType } from '../../models/budget.model';
import { UnixToDatePipe } from '../../unix-to-date.pipe';

interface CategorizedTransaction extends ProcessedTransaction {
  bucketId?: string;
  bucketName?: string;
}

interface BucketWithTransactions extends Bucket {
  transactions: CategorizedTransaction[];
  totalAmount: number; // Sum of all transactions in this bucket, for display purposes
  expanded?: boolean;

  // New properties for goal display
  goalIsActiveAndConfigured?: boolean;
  goalDescription?: string;
  goalCurrentSum?: number;
  goalTargetAmountForDisplay?: number;
  goalProgressPercentage?: number;
  goalAmountRelevant?: number;
  goalAmountRemaining?: number;
  goalIsMetOrOnTrack?: boolean;
  goalPeriodDisplayString?: string;
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

  accountSummaryFolded: boolean = false;

  // Expose enums to the template
  public readonly GoalType = GoalType;
  public readonly GoalTimePeriodType = GoalTimePeriodType;


  private subscriptions = new Subscription();

  constructor(
    private dataService: SimpleFinDataService,
    private budgetConfigService: BudgetConfigService,
    private uiStateService: UiStateService,
    private ruleEngine: RuleEngineService
  ) {}

  async ngOnInit(): Promise<void> {
    this.buckets = this.budgetConfigService.getBuckets();

    this.accountSummaryFolded = await this.uiStateService.getFoldableState(UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED, false);

    this.subscriptions.add(this.dataService.accounts$.subscribe(accs => {
      this.accountSummary = accs;
      if (this.allTransactions.length > 0 || (this.allTransactions.length === 0 && this.buckets.length > 0)) { // Recategorize if buckets exist even with 0 tx
        this.categorizeTransactions();
      }
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
        }
      )
    );
  }

  private getActualGoalDateRange(goal: BucketGoal): { start: Date, end: Date } | null {
    const today = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    let startDate: Date;
    let endDate: Date;

    switch (goal.periodType) {
      case GoalTimePeriodType.CURRENT_MONTH:
        startDate = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
        endDate = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
        break;
      case GoalTimePeriodType.ROLLING_DAYS:
        if (!goal.rollingDays || goal.rollingDays <= 0) return null;
        endDate = endOfDay(today);
        startDate = startOfDay(new Date(today.getTime() - (goal.rollingDays - 1) * 24 * 60 * 60 * 1000));
        break;
      case GoalTimePeriodType.FIXED_DATE_RANGE:
        if (!goal.startDate || !goal.endDate) return null;
        startDate = startOfDay(new Date(goal.startDate + "T00:00:00"));
        endDate = endOfDay(new Date(goal.endDate + "T00:00:00"));
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
        break;
      case GoalTimePeriodType.CURRENT_YEAR:
        startDate = startOfDay(new Date(today.getFullYear(), 0, 1));
        endDate = endOfDay(new Date(today.getFullYear(), 11, 31));
        break;
      case GoalTimePeriodType.ALL_TIME:
        startDate = new Date(1970, 0, 1);
        endDate = new Date(2999, 11, 31);
        break;
      default:
        console.warn("Unknown goal period type:", goal.periodType);
        return null;
    }
    return { start: startDate, end: endDate };
  }

  private getGoalPeriodDisplayString(goal: BucketGoal, range: { start: Date, end: Date } | null): string {
    if (!range) return 'Invalid Period';
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

    switch (goal.periodType) {
      case GoalTimePeriodType.CURRENT_MONTH: return `This Month (${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })})`;
      case GoalTimePeriodType.ROLLING_DAYS: return `Last ${goal.rollingDays} Days`;
      case GoalTimePeriodType.FIXED_DATE_RANGE:
        return `${range.start.toLocaleDateString(undefined, options)} - ${range.end.toLocaleDateString(undefined, options)}`;
      case GoalTimePeriodType.CURRENT_YEAR: return `This Year (${new Date().getFullYear()})`;
      case GoalTimePeriodType.ALL_TIME: return 'All Time';
      default: return 'N/A';
    }
  }

  async categorizeTransactions(): Promise<void> {
    const uncategorizedInitialExpansion = await this.uiStateService.getFoldableState(UI_DASHBOARD_UNCATEGORIZED_EXPANDED, false);

    if (!this.allTransactions || !this.buckets) {
        this.categorizedBuckets = (this.buckets || []).map(b => ({ ...b, transactions: [], totalAmount: 0, expanded: false, goalIsActiveAndConfigured: false }));
        return;
    }

    if (this.allTransactions.length === 0 && this.buckets.length === 0) {
        this.categorizedBuckets = [];
        return;
    }
    
    if (this.allTransactions.length > 0 && this.buckets.length === 0) {
        this.categorizedBuckets = [{
            id: 'uncategorized', name: 'Uncategorized Transactions', priority: 9999, rules: [],
            transactions: [...this.allTransactions],
            expanded: uncategorizedInitialExpansion,
            totalAmount: this.allTransactions.reduce((sum, t) => sum + (t.amountNum || 0), 0),
            goalIsActiveAndConfigured: false
        }];
        return;
    }

    const tempCategorizedTransactions: CategorizedTransaction[] = this.allTransactions.map(tx => ({...tx}));
    const assignedTransactionIds = new Set<string>();
    const newCategorizedBuckets: BucketWithTransactions[] = [];

    const sortedBuckets = [...this.buckets].sort((a, b) => a.priority - b.priority);

    for (const bucket of sortedBuckets) {
      const bucketTransactions: CategorizedTransaction[] = [];
      let bucketTotalForDisplay = 0;
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
        }
      }
      bucketTotalForDisplay = bucketTransactions.reduce((sum, tx) => sum + (tx.amountNum || 0), 0);

      let goalData: Partial<BucketWithTransactions> = { goalIsActiveAndConfigured: false };
      if (bucket.goal && bucket.goal.isActive) {
        const goalDateRange = this.getActualGoalDateRange(bucket.goal);
        goalData.goalPeriodDisplayString = this.getGoalPeriodDisplayString(bucket.goal, goalDateRange);
        goalData.goalIsActiveAndConfigured = true;
        goalData.goalTargetAmountForDisplay = bucket.goal.targetAmount;

        if (goalDateRange && bucket.goal.targetAmount != null) { // Check targetAmount for null/undefined
          const transactionsInPeriod = bucketTransactions.filter(tx => {
            const txDate = new Date(tx.posted * 1000);
            return txDate >= goalDateRange.start && txDate <= goalDateRange.end;
          });

          goalData.goalCurrentSum = transactionsInPeriod.reduce((sum, tx) => sum + (tx.amountNum || 0), 0);

          if (bucket.goal.goalType === GoalType.SAVINGS) {
            goalData.goalAmountRelevant = goalData.goalCurrentSum;
            goalData.goalAmountRemaining = Math.max(0, bucket.goal.targetAmount - goalData.goalAmountRelevant);
            goalData.goalIsMetOrOnTrack = goalData.goalAmountRelevant >= bucket.goal.targetAmount;
          } else { // GoalType.SPENDING_LIMIT
            goalData.goalAmountRelevant = goalData.goalCurrentSum < 0 ? Math.abs(goalData.goalCurrentSum) : 0;
            goalData.goalAmountRemaining = Math.max(0, bucket.goal.targetAmount - goalData.goalAmountRelevant);
            goalData.goalIsMetOrOnTrack = goalData.goalAmountRelevant <= bucket.goal.targetAmount;
          }
          
          if (bucket.goal.targetAmount > 0) {
            goalData.goalProgressPercentage = (goalData.goalAmountRelevant / bucket.goal.targetAmount) * 100;
          } else {
            goalData.goalProgressPercentage = 0; // Default for 0 target
            if (bucket.goal.goalType === GoalType.SAVINGS && goalData.goalAmountRelevant >= 0) {
                goalData.goalProgressPercentage = 100; // Saved 0 or more for a 0 target
            } else if (bucket.goal.goalType === GoalType.SPENDING_LIMIT && goalData.goalAmountRelevant === 0) {
                goalData.goalProgressPercentage = 100; // Spent 0 for a 0 limit
            }
          }
        } else {
          goalData.goalCurrentSum = 0;
          goalData.goalAmountRelevant = 0;
          goalData.goalProgressPercentage = 0;
          goalData.goalAmountRemaining = bucket.goal?.targetAmount || 0;
          goalData.goalIsMetOrOnTrack = false;
          if (bucket.goal && bucket.goal.targetAmount === 0) { // Specific check for 0 target goals
              if (bucket.goal.goalType === GoalType.SPENDING_LIMIT && goalData.goalAmountRelevant === 0) goalData.goalIsMetOrOnTrack = true;
              if (bucket.goal.goalType === GoalType.SAVINGS && goalData.goalAmountRelevant >= 0) goalData.goalIsMetOrOnTrack = true;
          }
        }
      }

      newCategorizedBuckets.push({
        ...bucket,
        transactions: bucketTransactions,
        totalAmount: bucketTotalForDisplay,
        expanded: initialExpandedState,
        ...goalData
      });
    }

    const uncategorizedTransactions = tempCategorizedTransactions.filter(tx => !assignedTransactionIds.has(tx.id));
    if (uncategorizedTransactions.length > 0) {
      newCategorizedBuckets.push({
        id: 'uncategorized', name: 'Uncategorized Transactions', priority: 9999, rules: [],
        transactions: uncategorizedTransactions.map(tx => ({...tx})),
        expanded: uncategorizedInitialExpansion,
        totalAmount: uncategorizedTransactions.reduce((sum, t) => sum + (t.amountNum || 0), 0),
        goalIsActiveAndConfigured: false
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

  // Getter for default currency display
  getBucketDisplayCurrency(bucket: BucketWithTransactions): string {
    if (bucket.transactions && bucket.transactions.length > 0 && bucket.transactions[0].currency) {
      return bucket.transactions[0].currency;
    }
    // If bucket has a goal, we might infer currency context from it, but goal doesn't store currency.
    // So, we fall back to a default.
    return 'USD';
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}

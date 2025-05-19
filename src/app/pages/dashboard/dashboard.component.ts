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

/**
 * Represents a transaction that has been augmented with bucket information
 * after categorization.
 */
interface CategorizedTransaction extends ProcessedTransaction {
  /** The ID of the bucket this transaction has been assigned to. Optional if uncategorized. */
  bucketId?: string;
  /** The name of the bucket this transaction has been assigned to. Optional if uncategorized. */
  bucketName?: string;
}

/**
 * Extends the base `Bucket` model with additional properties relevant for display
 * on the dashboard, including its assigned transactions, total amount, expansion state,
 * and detailed goal progress information.
 */
interface BucketWithTransactions extends Bucket {
  /** Array of transactions categorized into this bucket. */
  transactions: CategorizedTransaction[];
  /** The sum of amounts of all transactions currently in this bucket. */
  totalAmount: number;
  /** UI state indicating whether this bucket's transaction list is expanded or collapsed. */
  expanded?: boolean;

  // --- Goal-related display properties ---
  /** True if the bucket has an active and properly configured goal. */
  goalIsActiveAndConfigured?: boolean;
  /** A user-friendly description of the goal (currently not used but planned). */
  goalDescription?: string; // Potential future use
  /** The current sum of transaction amounts relevant to the goal's period and type. */
  goalCurrentSum?: number;
  /** The target amount of the goal, for display. */
  goalTargetAmountForDisplay?: number;
  /** The progress towards the goal, represented as a percentage. */
  goalProgressPercentage?: number;
  /** The portion of `goalCurrentSum` that is considered "relevant" towards the goal
   *  (e.g., absolute value for spending limits, positive sum for savings). */
  goalAmountRelevant?: number;
  /** The remaining amount needed to achieve the goal (for savings) or stay within the limit (for spending). */
  goalAmountRemaining?: number;
  /** True if the goal is met (for savings) or if spending is on track (within limit). */
  goalIsMetOrOnTrack?: boolean;
  /** A user-friendly string describing the goal's time period (e.g., "This Month", "Last 30 Days"). */
  goalPeriodDisplayString?: string;
}

// Define constants for UI state IDs used with UiStateService
const UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED = 'dashboardAccountSummaryFolded';
const UI_DASHBOARD_UNCATEGORIZED_EXPANDED = 'dashboardUncategorizedExpanded';

/**
 * DashboardComponent is the main view for users after they've set up their budget.
 * It displays:
 * - A summary of accounts and their balances.
 * - Transactions categorized into user-defined buckets.
 * - Progress towards any budget goals set on these buckets.
 * - Uncategorized transactions.
 * It subscribes to data services to get the latest financial data and budget configuration,
 * then processes this data for display.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, UnixToDatePipe, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  buckets: Bucket[] = []; // Raw buckets from config
  accountSummary: Account[] = []; // Account data from SimpleFin
  allTransactions: ProcessedTransaction[] = []; // All transactions from SimpleFin

  categorizedBuckets: BucketWithTransactions[] = []; // Buckets with their transactions and goal data
  isLoading: boolean = false; // Loading state from SimpleFinDataService
  errorMessage: string | null = null; // Error messages from SimpleFinDataService
  hasStoredAccessDetails: boolean = false; // Indicates if SimpleFin access is configured

  accountSummaryFolded: boolean = false; // UI state for account summary section

  // Expose enums to the template for use in ngSwitch or similar directives
  public readonly GoalType = GoalType;
  public readonly GoalTimePeriodType = GoalTimePeriodType;

  private subscriptions = new Subscription(); // Manages all component subscriptions

  constructor(
    private dataService: SimpleFinDataService,
    private budgetConfigService: BudgetConfigService,
    private uiStateService: UiStateService,
    private ruleEngine: RuleEngineService
  ) {}

  /**
   * Initializes the component.
   * Sets up subscriptions to data services (accounts, transactions, loading state, errors, access details).
   * Loads initial UI states (e.g., folded state of account summary).
   * Triggers initial transaction categorization.
   */
  async ngOnInit(): Promise<void> {
    this.buckets = this.budgetConfigService.getBuckets(); // Load bucket configuration

    // Load initial UI state for account summary section
    this.accountSummaryFolded = await this.uiStateService.getFoldableState(UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED, false);

    // Subscribe to account data changes
    this.subscriptions.add(this.dataService.accounts$.subscribe(accs => {
      this.accountSummary = accs;
      // Recategorize transactions if accounts change, as account info might be used in display
      // or if buckets exist (even with 0 transactions, to display empty buckets).
      if (this.allTransactions.length > 0 || (this.allTransactions.length === 0 && this.buckets.length > 0)) {
        this.categorizeTransactions();
      }
    }));

    // Subscribe to transaction data changes
    this.subscriptions.add(this.dataService.transactions$.subscribe(txs => {
      this.allTransactions = txs;
      this.categorizeTransactions(); // Re-run categorization when transactions update
    }));

    // Subscribe to loading state and error messages from data service
    this.subscriptions.add(this.dataService.isLoading$.subscribe(loading => this.isLoading = loading));
    this.subscriptions.add(this.dataService.errorMessage$.subscribe(err => this.errorMessage = err));

    // Subscribe to changes in stored access details availability
    this.subscriptions.add(
      this.dataService.hasStoredAccessDetails$.subscribe(
        (hasDetails: boolean) => {
          this.hasStoredAccessDetails = hasDetails;
          if (!hasDetails) {
            // If access details are removed, clear local data displays
            this.allTransactions = [];
            this.accountSummary = [];
            this.categorizeTransactions(); // Update display to show empty state
          }
        }
      )
    );
  }

  /**
   * Calculates the actual start and end dates for a given bucket goal based on its period type.
   * Normalizes dates to the start or end of the day as appropriate for comparisons.
   * - `CURRENT_MONTH`: Full current month.
   * - `ROLLING_DAYS`: Specified number of days ending today.
   * - `FIXED_DATE_RANGE`: User-defined start and end dates.
   * - `CURRENT_YEAR`: Full current calendar year.
   * - `ALL_TIME`: A very wide date range effectively covering all possible transaction dates.
   * @param goal The `BucketGoal` object defining the goal's period.
   * @returns An object with `start` and `end` Date objects, or `null` if the goal period is invalid (e.g., missing rolling days).
   */
  private getActualGoalDateRange(goal: BucketGoal): { start: Date, end: Date } | null {
    const today = new Date();
    // Helper to get the start of a given date (00:00:00.000)
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    // Helper to get the end of a given date (23:59:59.999)
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    let startDate: Date;
    let endDate: Date;

    switch (goal.periodType) {
      case GoalTimePeriodType.CURRENT_MONTH:
        startDate = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)); // First day of current month
        endDate = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)); // Last day of current month
        break;
      case GoalTimePeriodType.ROLLING_DAYS:
        if (!goal.rollingDays || goal.rollingDays <= 0) return null; // Invalid configuration
        endDate = endOfDay(today); // Today is the end of the period
        // Calculate start date by subtracting (rollingDays - 1) from today
        startDate = startOfDay(new Date(today.getTime() - (goal.rollingDays - 1) * 24 * 60 * 60 * 1000));
        break;
      case GoalTimePeriodType.FIXED_DATE_RANGE:
        if (!goal.startDate || !goal.endDate) return null; // Invalid configuration
        // Ensure parsing as local time by appending T00:00:00, then normalize
        startDate = startOfDay(new Date(goal.startDate + "T00:00:00"));
        endDate = endOfDay(new Date(goal.endDate + "T00:00:00"));
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null; // Invalid date strings
        break;
      case GoalTimePeriodType.CURRENT_YEAR:
        startDate = startOfDay(new Date(today.getFullYear(), 0, 1)); // January 1st of current year
        endDate = endOfDay(new Date(today.getFullYear(), 11, 31)); // December 31st of current year
        break;
      case GoalTimePeriodType.ALL_TIME:
        startDate = new Date(1970, 0, 1); // A very early date
        endDate = new Date(2999, 11, 31); // A very far future date
        break;
      default:
        console.warn("Unknown goal period type:", goal.periodType);
        return null;
    }
    return { start: startDate, end: endDate };
  }

  /**
   * Generates a user-friendly display string for a goal's time period.
   * @param goal The `BucketGoal` object.
   * @param range The calculated `{ start: Date, end: Date }` object from `getActualGoalDateRange`.
   * @returns A string representing the goal period (e.g., "This Month (October 2023)", "Last 30 Days").
   */
  private getGoalPeriodDisplayString(goal: BucketGoal, range: { start: Date, end: Date } | null): string {
    if (!range) return 'Invalid Period'; // Should not happen if range is validated before calling
    // Standard date formatting options for fixed ranges
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

    switch (goal.periodType) {
      case GoalTimePeriodType.CURRENT_MONTH:
        return `This Month (${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })})`;
      case GoalTimePeriodType.ROLLING_DAYS:
        return `Last ${goal.rollingDays} Days`;
      case GoalTimePeriodType.FIXED_DATE_RANGE:
        return `${range.start.toLocaleDateString(undefined, options)} - ${range.end.toLocaleDateString(undefined, options)}`;
      case GoalTimePeriodType.CURRENT_YEAR:
        return `This Year (${new Date().getFullYear()})`;
      case GoalTimePeriodType.ALL_TIME:
        return 'All Time';
      default:
        return 'N/A'; // Should not be reached
    }
  }

  /**
   * Applies configured bucket rules to a list of transactions.
   * Each transaction is assigned to the first bucket (by priority) whose active rules it matches.
   * Transactions that don't match any bucket rules are considered uncategorized.
   * @param transactions The array of `ProcessedTransaction` objects to categorize.
   * @param buckets The array of `Bucket` configurations.
   * @returns An object containing:
   *          `categorized`: A Map where keys are bucket IDs and values are arrays of `CategorizedTransaction`.
   *          `uncategorized`: An array of `CategorizedTransaction` that did not match any bucket.
   */
  private applyRulesToTransactions(
    transactions: ProcessedTransaction[],
    buckets: Bucket[]
  ): { categorized: Map<string, CategorizedTransaction[]>, uncategorized: CategorizedTransaction[] } {
    const categorizedResult = new Map<string, CategorizedTransaction[]>();
    const uncategorizedResult: CategorizedTransaction[] = [];
    const assignedTransactionIds = new Set<string>(); // Track IDs of transactions already assigned

    // Initialize map entries for all buckets
    for (const bucket of buckets) {
      categorizedResult.set(bucket.id, []);
    }

    // Sort buckets by priority to ensure correct assignment order
    const sortedBuckets = [...buckets].sort((a, b) => a.priority - b.priority);

    // Iterate over each transaction
    for (const tx of transactions) {
      let matched = false;
      // Iterate over sorted buckets
      for (const bucket of sortedBuckets) {
        // Check if transaction matches any active rule in this bucket
        for (const bucketRule of bucket.rules) {
          if (bucketRule.isActive) {
            const ruleDefinition = this.budgetConfigService.getRuleById(bucketRule.ruleId);
            if (ruleDefinition && this.ruleEngine.evaluateTransactionAgainstRule(tx, ruleDefinition)) {
              // Match found: assign transaction to this bucket
              const categorizedTx: CategorizedTransaction = { ...tx, bucketId: bucket.id, bucketName: bucket.name };
              categorizedResult.get(bucket.id)?.push(categorizedTx);
              assignedTransactionIds.add(tx.id);
              matched = true;
              break; // Stop checking rules for this bucket
            }
          }
        }
        if (matched) break; // Stop checking other buckets for this transaction
      }
      // If transaction wasn't matched to any bucket, add to uncategorized
      if (!matched) {
        uncategorizedResult.push({ ...tx }); // No bucketId/bucketName needed
      }
    }
    return { categorized: categorizedResult, uncategorized: uncategorizedResult };
  }

  /**
   * Calculates goal-related data for a specific bucket given its transactions.
   * @param bucket The `Bucket` definition, containing goal configuration.
   * @param bucketTransactions An array of `CategorizedTransaction` already assigned to this bucket.
   * @returns A `Partial<BucketWithTransactions>` object containing calculated goal properties.
   *          Returns `{ goalIsActiveAndConfigured: false }` if the goal is not active or not configured.
   */
  private calculateBucketGoalData(bucket: Bucket, bucketTransactions: CategorizedTransaction[]): Partial<BucketWithTransactions> {
    const goalData: Partial<BucketWithTransactions> = { goalIsActiveAndConfigured: false };

    if (!bucket.goal || !bucket.goal.isActive || bucket.goal.targetAmount == null) {
      return goalData; // Goal not active or target not set
    }

    goalData.goalIsActiveAndConfigured = true;
    goalData.goalTargetAmountForDisplay = bucket.goal.targetAmount;

    const goalDateRange = this.getActualGoalDateRange(bucket.goal);
    goalData.goalPeriodDisplayString = this.getGoalPeriodDisplayString(bucket.goal, goalDateRange);

    if (!goalDateRange) { // Should not happen if goal.periodType is valid
      goalData.goalCurrentSum = 0;
      goalData.goalAmountRelevant = 0;
      goalData.goalProgressPercentage = 0;
      goalData.goalAmountRemaining = bucket.goal.targetAmount;
      goalData.goalIsMetOrOnTrack = false; // Cannot determine without a valid range
      return goalData;
    }

    // Filter transactions to only those within the goal's active date range
    const transactionsInPeriod = bucketTransactions.filter(tx => {
      const txDate = new Date(tx.posted * 1000);
      return txDate >= goalDateRange.start && txDate <= goalDateRange.end;
    });

    // Sum of all transactions in the bucket within the goal period
    goalData.goalCurrentSum = transactionsInPeriod.reduce((sum, tx) => sum + (tx.amountNum || 0), 0);

    // Determine "relevant" amount and progress based on goal type (Savings vs. Spending Limit)
    if (bucket.goal.goalType === GoalType.SAVINGS) {
      // For savings, positive amounts contribute.
      // If goalCurrentSum is negative (e.g. money moved out), it detracts from savings.
      goalData.goalAmountRelevant = goalData.goalCurrentSum; // Can be negative if more withdrawn than saved
      goalData.goalAmountRemaining = Math.max(0, bucket.goal.targetAmount - goalData.goalAmountRelevant);
      goalData.goalIsMetOrOnTrack = goalData.goalAmountRelevant >= bucket.goal.targetAmount;
    } else { // GoalType.SPENDING_LIMIT
      // For spending limits, only negative amounts (spending) count towards the limit.
      // Positive amounts (refunds) reduce the "spent" amount.
      // If goalCurrentSum is positive (more refunds than spending), relevant amount is 0.
      goalData.goalAmountRelevant = goalData.goalCurrentSum < 0 ? Math.abs(goalData.goalCurrentSum) : 0;
      goalData.goalAmountRemaining = Math.max(0, bucket.goal.targetAmount - goalData.goalAmountRelevant);
      goalData.goalIsMetOrOnTrack = goalData.goalAmountRelevant <= bucket.goal.targetAmount;
    }

    // Calculate progress percentage
    if (bucket.goal.targetAmount > 0) {
      goalData.goalProgressPercentage = (goalData.goalAmountRelevant / bucket.goal.targetAmount) * 100;
    } else { // Target is 0 or less (less common, but handle)
      goalData.goalProgressPercentage = 0;
      if (bucket.goal.goalType === GoalType.SAVINGS && goalData.goalAmountRelevant >= 0) {
        goalData.goalProgressPercentage = 100; // Saved 0 or more for a 0 target
      } else if (bucket.goal.goalType === GoalType.SPENDING_LIMIT && goalData.goalAmountRelevant === 0) {
        // If target is 0, and spent 0 (or got refunds making net positive), considered 100% on track.
        goalData.goalProgressPercentage = 100;
      }
    }
    return goalData;
  }


  /**
   * Orchestrates the categorization of all transactions into buckets based on defined rules.
   * It then calculates display totals and goal progress for each bucket.
   * Finally, it updates `this.categorizedBuckets` for display in the template.
   * This method is asynchronous due to fetching UI state for bucket expansion.
   */
  async categorizeTransactions(): Promise<void> {
    const uncategorizedInitialExpansion = await this.uiStateService.getFoldableState(UI_DASHBOARD_UNCATEGORIZED_EXPANDED, false);

    // Handle edge cases: no transactions or no buckets
    if (!this.allTransactions || !this.buckets) {
        this.categorizedBuckets = (this.buckets || []).map(b => ({
             ...b, transactions: [], totalAmount: 0, expanded: false,
             goalIsActiveAndConfigured: false // Default goal state
        }));
        return;
    }
    if (this.allTransactions.length === 0 && this.buckets.length === 0) {
        this.categorizedBuckets = [];
        return;
    }
    // If transactions exist but no buckets, all are uncategorized
    if (this.allTransactions.length > 0 && this.buckets.length === 0) {
        this.categorizedBuckets = [{
            id: 'uncategorized', name: 'Uncategorized Transactions', priority: 9999, rules: [],
            transactions: [...this.allTransactions] as CategorizedTransaction[], // Cast needed
            expanded: uncategorizedInitialExpansion,
            totalAmount: this.allTransactions.reduce((sum, t) => sum + (t.amountNum || 0), 0),
            goalIsActiveAndConfigured: false
        }];
        return;
    }

    // Apply rules to categorize transactions
    const { categorized, uncategorized } = this.applyRulesToTransactions(this.allTransactions, this.buckets);
    const newCategorizedBuckets: BucketWithTransactions[] = [];
    const sortedBuckets = [...this.buckets].sort((a, b) => a.priority - b.priority);

    // Process each configured bucket
    for (const bucket of sortedBuckets) {
      const bucketTransactions = categorized.get(bucket.id) || [];
      const bucketTotalForDisplay = bucketTransactions.reduce((sum, tx) => sum + (tx.amountNum || 0), 0);
      const initialExpandedState = await this.uiStateService.getFoldableState(`bucket_${bucket.id}_expanded`, false);
      const goalData = this.calculateBucketGoalData(bucket, bucketTransactions);

      newCategorizedBuckets.push({
        ...bucket,
        transactions: bucketTransactions,
        totalAmount: bucketTotalForDisplay,
        expanded: initialExpandedState,
        ...goalData // Merge calculated goal properties
      });
    }

    // Add the "Uncategorized Transactions" bucket if there are any
    if (uncategorized.length > 0) {
      newCategorizedBuckets.push({
        id: 'uncategorized', name: 'Uncategorized Transactions', priority: 9999, rules: [], // Standard properties for a bucket
        transactions: uncategorized,
        expanded: uncategorizedInitialExpansion,
        totalAmount: uncategorized.reduce((sum, t) => sum + (t.amountNum || 0), 0),
        goalIsActiveAndConfigured: false // Uncategorized bucket has no goal
      });
    }
    this.categorizedBuckets = newCategorizedBuckets;
  }

  /**
   * Toggles the folded/unfolded state of the account summary section.
   * Persists the new state using `UiStateService`.
   */
  toggleAccountSummary(): void {
    this.accountSummaryFolded = !this.accountSummaryFolded;
    this.uiStateService.setFoldableState(UI_DASHBOARD_ACCOUNT_SUMMARY_FOLDED, this.accountSummaryFolded);
  }

  /**
   * Toggles the expanded/collapsed state of a specific bucket's transaction list.
   * Persists the new state using `UiStateService`.
   * @param bucket The `BucketWithTransactions` object whose state is to be toggled.
   */
  toggleTransactions(bucket: BucketWithTransactions): void {
    bucket.expanded = !bucket.expanded;
    // Determine the correct UI state ID based on whether it's a regular bucket or the special 'uncategorized' bucket
    const bucketStateId = bucket.id === 'uncategorized' ? UI_DASHBOARD_UNCATEGORIZED_EXPANDED : `bucket_${bucket.id}_expanded`;
    this.uiStateService.setFoldableState(bucketStateId, bucket.expanded as boolean);
  }

  /**
   * Determines the currency symbol to display for a bucket.
   * It attempts to use the currency from the first transaction in the bucket.
   * If the bucket is empty or transactions lack currency information, it defaults to 'USD'.
   * @param bucket The `BucketWithTransactions` object.
   * @returns A string representing the currency code (e.g., "USD", "EUR").
   */
  getBucketDisplayCurrency(bucket: BucketWithTransactions): string {
    if (bucket.transactions && bucket.transactions.length > 0 && bucket.transactions[0].currency) {
      return bucket.transactions[0].currency;
    }
    // Fallback if no transactions or currency info is missing.
    // In a multi-currency app, this might need to be more sophisticated,
    // perhaps based on user's primary currency or account currency if bucket is empty.
    return 'USD';
  }

  /**
   * Cleans up subscriptions when the component is destroyed to prevent memory leaks.
   */
  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}

// src/app/pages/setup-config/setup-config.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Bucket, Rule, FilterableField, StringOperator, NumericOperator, DateOperator,
  FilterCondition, FilterGroup, LogicalOperator,
  BucketGoal, GoalType, GoalTimePeriodType
} from '../../models/budget.model';
import { BudgetConfigService } from '../../services/budget-config.service';
import { SimpleFinDataService } from '../../services/simplefin-data.service';
import { UiStateService } from '../../services/ui-state.service';
import { FilterGroupComponent } from '../../components/filter-group/filter-group.component';

// Constants for UI state keys used with UiStateService to remember foldable section states.
/** UI state key for the "Manage Buckets" foldable section. */
const UI_SETUP_MANAGE_BUCKETS_FOLDED = 'setupManageBucketsFolded';
/** UI state key for the "Manage Rules" foldable section. */
const UI_SETUP_MANAGE_RULES_FOLDED = 'setupManageRulesFolded';
/** UI state key for the "Data Fetch Settings" foldable section. */
const UI_SETUP_DATA_FETCH_FOLDED = 'setupDataFetchFolded';

/**
 * SetupConfigComponent provides the user interface for managing budget configurations.
 * This includes:
 * - Creating, editing, and deleting budget buckets.
 * - Defining goals (savings or spending limits) for each bucket.
 * - Creating, editing, and deleting transaction categorization rules.
 * - Linking rules to buckets and managing their active state within a bucket.
 * - Configuring data fetch settings, such as the start date for transaction history.
 * It interacts with `BudgetConfigService` for managing bucket and rule data,
 * `SimpleFinDataService` for data fetch settings, and `UiStateService` for persisting
 * the folded/unfolded state of UI sections.
 */
@Component({
  selector: 'app-setup-config',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterGroupComponent], // FilterGroupComponent is used for rule definition
  templateUrl: './setup-config.component.html',
  styleUrls: ['./setup-config.component.css']
})
export class SetupConfigComponent implements OnInit {
  // --- Bucket Properties ---
  /** Array of all configured buckets. */
  buckets: Bucket[] = [];
  /** Name for a new or edited bucket, bound to the form input. */
  formBucketName: string = '';
  /** Priority for a new or edited bucket, bound to the form input. */
  formBucketPriority: number = 10;
  /** Holds the bucket currently being edited, or null if creating a new bucket. */
  editingBucket: Bucket | null = null;
  /** Holds the bucket currently selected for associating rules with it. */
  selectedBucketForRules: Bucket | null = null;

  // --- Goal Properties for Bucket Form ---
  /**
   * Holds the goal configuration for the bucket being added or edited.
   * Bound to the goal configuration section of the bucket form.
   */
  formBucketGoal: BucketGoal = this.createEmptyBucketGoal();

  // --- Rule Properties ---
  /** Array of all configured rules. */
  rules: Rule[] = [];
  /** Name for a new or edited rule, bound to the form input. */
  formRuleName: string = '';
  /**
   * Holds the rule currently being edited (deep copy), or null if creating a new rule.
   * A deep copy is used to allow changes in the rule configurator (FilterGroupComponent)
   * without directly affecting the original rule until explicitly saved.
   */
  editingRule: Rule | null = null;

  // --- Data Fetch Properties ---
  /** Start date for fetching transaction data, in 'YYYY-MM-DD' format for the input field. */
  dataFetchStartDate: string = '';

  // --- Foldable State Properties ---
  /** True if the "Manage Buckets" section is folded (collapsed). */
  manageBucketsFolded: boolean = true;
  /** True if the "Manage Rules" section is folded. */
  manageRulesFolded: boolean = true;
  /** True if the "Data Fetch Settings" section is folded. */
  dataFetchSettingsFolded: boolean = true;

  // --- Enums/Lists for Template Dropdowns ---
  // Exposing enums and constant lists to the template for iterating in dropdowns or ngSwitch.
  public readonly GoalType = GoalType;
  public readonly GoalTimePeriodType = GoalTimePeriodType;

  /** Options for the goal type dropdown in the bucket form. */
  public readonly goalTypeOptions = [
    { id: GoalType.SAVINGS, name: 'Savings Goal (Aim to accumulate)' },
    { id: GoalType.SPENDING_LIMIT, name: 'Spending Limit (Track expenses against a cap)' }
  ];
  /** Options for the goal time period type dropdown in the bucket form. */
  public readonly goalTimePeriodTypeOptions = [
    { id: GoalTimePeriodType.CURRENT_MONTH, name: 'This Current Month' },
    { id: GoalTimePeriodType.ROLLING_DAYS, name: 'Rolling Last X Days' },
    { id: GoalTimePeriodType.FIXED_DATE_RANGE, name: 'Fixed Date Range' },
    { id: GoalTimePeriodType.CURRENT_YEAR, name: 'This Current Year' },
    { id: GoalTimePeriodType.ALL_TIME, name: 'All Time (since data start)' }
  ];

  /**
   * List of fields available for filtering in rule conditions.
   * Each object defines the field's ID (key in ProcessedTransaction), display name, data type,
   * and an optional 'part' for date parts. This list is passed to FilterGroupComponent.
   */
  public readonly filterableFieldsList: Array<{ id: FilterableField, name: string, type: 'string' | 'number' | 'date' | 'datePart' | 'timeString', part?: 'dayOfWeek' | 'weekOfMonth' | 'monthOfYear' }> = [
    { id: 'payeeName', name: 'Payee Name', type: 'string' },
    { id: 'descriptionText', name: 'Description', type: 'string' },
    { id: 'orgName', name: 'Organization Name', type: 'string' },
    { id: 'accountName', name: 'Account Name', type: 'string' },
    { id: 'amountTransacted', name: 'Amount', type: 'number' },
    { id: 'balanceBefore', name: 'Balance Before', type: 'number' },
    { id: 'balanceAfter', name: 'Balance After', type: 'number' },
    { id: 'dayOfWeek', name: 'Day of Week (Sun=0, Mon=1..)', type: 'datePart', part: 'dayOfWeek' },
    { id: 'weekOfMonth', name: 'Week of Month (1-5)', type: 'datePart', part: 'weekOfMonth' },
    { id: 'monthOfYear', name: 'Month (Jan=0, Feb=1..)', type: 'datePart', part: 'monthOfYear' },
    { id: 'transactionTime', name: 'Transaction Time (HH:MM)', type: 'timeString' },
    { id: 'postedDate', name: 'Posted Date', type: 'date' }
  ];
  /** Operators for string-type fields in rule conditions. */
  public readonly stringOperators: Array<{ id: StringOperator, name: string }> = [
    { id: 'exactMatch', name: 'Exactly Matches' }, { id: 'contains', name: 'Contains' },
    { id: 'doesNotContain', name: 'Does Not Contain' }, { id: 'startsWith', name: 'Starts With' },
    { id: 'endsWith', name: 'Ends With' }, { id: 'regex', name: 'Matches Regex' }
  ];
  /** Operators for number-type fields in rule conditions. */
  public readonly numberOperators: Array<{ id: NumericOperator, name: string }> = [
    { id: 'equalTo', name: 'Equal To (=)' }, { id: 'notEqualTo', name: 'Not Equal To (≠)' },
    { id: 'greaterThan', name: 'Greater Than (>)' }, { id: 'lessThan', name: 'Less Than (<)' },
    { id: 'greaterThanOrEqualTo', name: 'Greater Than or Equal To (≥)' },
    { id: 'lessThanOrEqualTo', name: 'Less Than or Equal To (≤)' },
    { id: 'between', name: 'Between (inclusive)' }
  ];
  /** Operators for date-type fields in rule conditions. */
  public readonly dateOperators: Array<{ id: DateOperator, name: string }> = [
    { id: 'onDate', name: 'On Date' }, { id: 'beforeDate', name: 'Before Date' },
    { id: 'afterDate', name: 'After Date' }, { id: 'betweenDates', name: 'Between Dates (inclusive)' }
  ];
  /** Operators for date-part fields (dayOfWeek, monthOfYear, etc.) in rule conditions. */
  public readonly datePartOperators: Array<{ id: Extract<NumericOperator, 'equalTo' | 'notEqualTo'>, name: string }> = [
    { id: 'equalTo', name: 'Is' }, { id: 'notEqualTo', name: 'Is Not' }
  ];
  /** Operators for time string fields (HH:MM) in rule conditions. */
  public readonly timeStringOperators: Array<{ id: Extract<StringOperator, 'exactMatch'> , name: string }> = [
    { id: 'exactMatch', name: 'Exactly At (HH:MM)'}
  ];

  constructor(
    private budgetConfigService: BudgetConfigService,
    private dataService: SimpleFinDataService,
    private uiStateService: UiStateService
  ) {}

  /**
   * Initializes the component.
   * Loads existing buckets and rules from `BudgetConfigService`.
   * Resets form fields for creating new buckets and rules.
   * Retrieves the configured data fetch start date from `SimpleFinDataService`.
   * Loads the persisted folded states for UI sections from `UiStateService`.
   */
  async ngOnInit(): Promise<void> {
    this.loadBuckets();
    this.loadRules();
    this.resetBucketFormFields();
    this.resetRuleFormFields();

    const configuredDate = this.dataService.getConfiguredStartDate();
    this.dataFetchStartDate = configuredDate.toISOString().split('T')[0]; // Format for date input

    // Load persisted UI states for foldable sections
    this.manageBucketsFolded = await this.uiStateService.getFoldableState(UI_SETUP_MANAGE_BUCKETS_FOLDED, true);
    this.manageRulesFolded = await this.uiStateService.getFoldableState(UI_SETUP_MANAGE_RULES_FOLDED, true);
    this.dataFetchSettingsFolded = await this.uiStateService.getFoldableState(UI_SETUP_DATA_FETCH_FOLDED, true);
  }

  /**
   * Creates an empty `BucketGoal` object with default values.
   * Used to initialize `formBucketGoal` when creating a new bucket or when an existing bucket has no goal.
   * @returns {BucketGoal} A new `BucketGoal` object with default settings.
   */
  createEmptyBucketGoal(): BucketGoal {
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());

    return {
      isActive: false,
      targetAmount: 0,
      goalType: GoalType.SPENDING_LIMIT, // Default goal type
      periodType: GoalTimePeriodType.CURRENT_MONTH, // Default period type
      rollingDays: 30, // Default for rolling days
      startDate: today.toISOString().split('T')[0], // Default start date (today)
      endDate: nextMonth.toISOString().split('T')[0] // Default end date (next month)
    };
  }

  // --- Bucket Methods ---

  /** Loads buckets from the `BudgetConfigService` into the component's `buckets` array. */
  loadBuckets(): void { this.buckets = this.budgetConfigService.getBuckets(); }

  /** Resets the bucket form fields to their default states for creating a new bucket. */
  resetBucketFormFields(): void {
    this.formBucketName = '';
    // Default priority for new bucket is 10 more than the current highest priority
    const maxPriority = this.buckets.length > 0 ? Math.max(...this.buckets.map(b => b.priority)) : 0;
    this.formBucketPriority = maxPriority + 10;
    this.editingBucket = null; // Clear any bucket being edited
    this.formBucketGoal = this.createEmptyBucketGoal(); // Reset goal form part
  }

  /**
   * Handles the submission of the bucket form.
   * If `editingBucket` is set, it updates the existing bucket; otherwise, it adds a new bucket.
   */
  submitBucketForm(): void {
    if (this.editingBucket) {
      this.saveEditBucket();
    } else {
      this.addBucket();
    }
  }

  /**
   * Adds a new bucket using the data from `formBucketName`, `formBucketPriority`, and `formBucketGoal`.
   * Validates that the name is not empty and priority is positive.
   * Updates the bucket with goal information if a goal is active.
   */
  addBucket(): void {
    if (this.formBucketName.trim() && this.formBucketPriority > 0) {
      const newBucketName = this.formBucketName.trim();
      const newBucketPriority = this.formBucketPriority;
      // Include goal data only if the goal form section indicates it's active.
      const newBucketGoal = this.formBucketGoal.isActive ? { ...this.formBucketGoal } : undefined;

      // Add bucket using service, which generates ID and handles initial save.
      const tempBucket = this.budgetConfigService.addBucket(newBucketName, newBucketPriority);
      
      // If a goal was configured (isActive was true), update the newly created bucket with the goal object.
      if (tempBucket && newBucketGoal) {
        const bucketToUpdate: Bucket = {
            ...tempBucket, // This includes the ID generated by the service
            goal: newBucketGoal
        };
        this.budgetConfigService.updateBucket(bucketToUpdate); // Save the bucket again with goal info
      }

      this.loadBuckets(); // Reload to get the final list including the new/updated bucket
      this.resetBucketFormFields(); // Clear form for next entry
    }
  }

  /**
   * Deletes a bucket after user confirmation.
   * Also clears `editingBucket` and `selectedBucketForRules` if the deleted bucket was selected.
   * @param {string} bucketId - The ID of the bucket to delete.
   */
  deleteBucket(bucketId: string): void {
    if (confirm('Are you sure you want to delete this bucket? Its rule associations will also be removed.')) {
      this.budgetConfigService.deleteBucket(bucketId);
      this.loadBuckets(); // Refresh bucket list
      // If the deleted bucket was being edited or selected for rules, clear those states.
      if (this.editingBucket && this.editingBucket.id === bucketId) { this.resetBucketFormFields(); }
      if (this.selectedBucketForRules && this.selectedBucketForRules.id === bucketId) { this.selectedBucketForRules = null; }
    }
  }

  /**
   * Populates the bucket form fields with the data of the bucket selected for editing.
   * Creates a deep copy of the bucket's goal for editing to prevent direct modification.
   * @param {Bucket} bucket - The bucket to edit.
   */
  startEditBucket(bucket: Bucket): void {
    this.editingBucket = bucket; // Keep reference to original for update
    this.formBucketName = bucket.name;
    this.formBucketPriority = bucket.priority;
    // Deep copy goal object to avoid modifying original until save
    this.formBucketGoal = bucket.goal ? JSON.parse(JSON.stringify(bucket.goal)) : this.createEmptyBucketGoal();
  }

  /**
   * Saves the changes to the bucket currently being edited.
   * Validates form fields before saving.
   */
  saveEditBucket(): void {
    if (this.editingBucket && this.formBucketName.trim() && this.formBucketPriority > 0) {
      const updatedBucketData: Bucket = {
        ...this.editingBucket,
        name: this.formBucketName.trim(),
        priority: this.formBucketPriority,
        // Include goal data only if the goal form section indicates it's active.
        goal: this.formBucketGoal.isActive ? { ...this.formBucketGoal } : undefined
      };
      this.budgetConfigService.updateBucket(updatedBucketData);
      this.loadBuckets(); // Refresh bucket list
      this.resetBucketFormFields(); // Clear form
    }
  }

  /** Cancels editing a bucket and resets the bucket form fields. */
  cancelEditBucket(): void { this.resetBucketFormFields(); }

  // --- Rule Methods ---

  /** Loads rules from `BudgetConfigService` into the component's `rules` array. */
  loadRules(): void { this.rules = this.budgetConfigService.getRules(); }

  /** Resets the rule form fields to their default states for creating a new rule. */
  resetRuleFormFields(): void { this.formRuleName = ''; this.editingRule = null; }

  /**
   * Handles the submission of the rule form.
   * If `editingRule` is set (and contains changes), it updates the existing rule;
   * otherwise, it adds a new rule.
   */
  submitRuleForm(): void {
    if (this.editingRule) { // If editing an existing rule
      if (this.formRuleName.trim()) { // Ensure name is not empty
        this.editingRule.name = this.formRuleName.trim(); // Update name from form
        // The filterGroup within this.editingRule is already updated by FilterGroupComponent via [(ngModel)]
        this.budgetConfigService.updateRule(this.editingRule);
        this.loadRules(); // Refresh rule list
        this.resetRuleFormFields(); // Clear form
      }
    } else { // If creating a new rule
      this.addRule();
    }
  }

  /** Adds a new rule using the data from `formRuleName`. */
  addRule(): void {
    if (this.formRuleName.trim()) {
      this.budgetConfigService.addRule(this.formRuleName.trim());
      this.loadRules(); // Refresh rule list
      this.resetRuleFormFields(); // Clear form
    }
  }

  /**
   * Populates the rule form fields for editing a selected rule.
   * Creates a deep copy of the rule (especially its `filterGroup`) to allow isolated editing
   * in the `FilterGroupComponent` before saving.
   * @param {Rule} rule - The rule to edit.
   */
  startEditRule(rule: Rule): void {
    // Deep copy the rule to prevent direct modification of the original object,
    // especially for the nested filterGroup, before explicit save.
    this.editingRule = JSON.parse(JSON.stringify(rule));
    if (this.editingRule) {
        this.formRuleName = this.editingRule.name;
    } else {
        // Should not happen if rule is valid, but as a safeguard:
        this.resetRuleFormFields();
    }
  }

  /**
   * Deletes a rule after user confirmation.
   * Also clears `editingRule` if the deleted rule was being edited.
   * Reloads both rules and buckets (as buckets might have references to the deleted rule).
   * @param {string} ruleId - The ID of the rule to delete.
   */
  deleteRule(ruleId: string): void {
    if (confirm('Are you sure? This will remove the rule from all buckets it is associated with.')) {
      this.budgetConfigService.deleteRule(ruleId);
      this.loadRules(); // Refresh rule list
      this.loadBuckets(); // Refresh buckets as rule associations might change
      if (this.editingRule && this.editingRule.id === ruleId) { this.resetRuleFormFields(); }
    }
  }

  /** Cancels editing a rule and resets the rule form fields. */
  cancelEditRule(): void { this.resetRuleFormFields(); }

  // --- Linking Rules to Buckets ---

  /** Sets `selectedBucketForRules` to display the rule association UI for the given bucket. */
  openBucketRuleConfig(bucket: Bucket): void { this.selectedBucketForRules = bucket; }

  /** Clears `selectedBucketForRules` to hide the rule association UI. */
  closeBucketRuleConfig(): void { this.selectedBucketForRules = null; }

  /**
   * Checks if a rule (by ID) is currently associated with the `selectedBucketForRules`.
   * @param {string} ruleId - The ID of the rule to check.
   * @returns {boolean} True if the rule is in the selected bucket, false otherwise.
   */
  isRuleInBucket(ruleId: string): boolean {
    if (!this.selectedBucketForRules) return false;
    return this.selectedBucketForRules.rules.some(br => br.ruleId === ruleId);
  }

  /**
   * Toggles the association of a rule with the `selectedBucketForRules`.
   * If the rule is added, it's set to active by default.
   * @param {string} ruleId - The ID of the rule to toggle.
   * @param {Event} event - The checkbox change event.
   */
  toggleRuleForBucket(ruleId: string, event: Event): void {
    if (!this.selectedBucketForRules) return;
    const target = event.target as HTMLInputElement;
    const isChecked = target.checked; // True if rule should be associated, false if disassociated

    let newRulesArray = [...this.selectedBucketForRules.rules];
    const existingRuleIndex = newRulesArray.findIndex(br => br.ruleId === ruleId);

    if (isChecked && existingRuleIndex === -1) { // Add rule to bucket if checked and not present
      newRulesArray.push({ ruleId: ruleId, isActive: true }); // Default to active when adding
    } else if (!isChecked && existingRuleIndex > -1) { // Remove rule from bucket if unchecked and present
      newRulesArray.splice(existingRuleIndex, 1);
    }

    const updatedBucket: Bucket = { ...this.selectedBucketForRules, rules: newRulesArray };
    this.budgetConfigService.updateBucket(updatedBucket);
    this.selectedBucketForRules = updatedBucket; // Keep the selection updated
    this.loadBuckets(); // Refresh the main buckets list to reflect changes
  }

  /**
   * Checks if a rule (by ID) associated with `selectedBucketForRules` is currently active.
   * @param {string} ruleId - The ID of the rule to check.
   * @returns {boolean} True if the rule is in the bucket and active, false otherwise.
   */
  isRuleActiveInBucket(ruleId: string): boolean {
    if (!this.selectedBucketForRules) return false;
    const bucketRule = this.selectedBucketForRules.rules.find(br => br.ruleId === ruleId);
    return bucketRule ? bucketRule.isActive : false; // Default to false if somehow not found
  }

  /**
   * Toggles the active/inactive state of a rule that is already associated with `selectedBucketForRules`.
   * @param {string} ruleId - The ID of the rule whose active state is to be toggled.
   * @param {Event} event - The checkbox change event.
   */
  toggleRuleActiveState(ruleId: string, event: Event): void {
    if (!this.selectedBucketForRules) return;
    const target = event.target as HTMLInputElement;
    const isActive = target.checked;
    let ruleUpdated = false;

    const newRulesArray = this.selectedBucketForRules.rules.map(br => {
      if (br.ruleId === ruleId) {
        ruleUpdated = true;
        return { ...br, isActive: isActive };
      }
      return br;
    });

    if (ruleUpdated) {
      const updatedBucket: Bucket = { ...this.selectedBucketForRules, rules: newRulesArray };
      this.budgetConfigService.updateBucket(updatedBucket);
      this.selectedBucketForRules = updatedBucket; // Keep selection updated
      // No need to call loadBuckets() here as the object reference in the main list is the same.
    }
  }

  // --- Rule Configurator Helper Methods (passed to FilterGroupComponent) ---

  /**
   * Provides the list of applicable operators for a given filterable field ID.
   * This method is passed as an input to the `FilterGroupComponent`.
   * @param {FilterableField | undefined} fieldId - The ID of the field.
   * @returns {any[]} An array of operator objects suitable for that field type.
   */
  getOperatorsForField = (fieldId: FilterableField | undefined): any[] => {
    if (!fieldId) return [];
    const fieldDef = this.filterableFieldsList.find(f => f.id === fieldId);
    if (!fieldDef) return [];
    switch (fieldDef.type) {
      case 'string': return this.stringOperators;
      case 'number': return this.numberOperators;
      case 'date': return this.dateOperators;
      case 'datePart': return this.datePartOperators;
      case 'timeString': return this.timeStringOperators;
      default: return [];
    }
  }

  /**
   * Returns the data type of a given filterable field ID.
   * This method is passed as an input to the `FilterGroupComponent`.
   * @param {FilterableField | undefined} fieldId - The ID of the field.
   * @returns {string | undefined} The type of the field (e.g., 'string', 'number').
   */
  getFieldType = (fieldId: FilterableField | undefined): string | undefined => {
    const fieldDef = this.filterableFieldsList.find(f => f.id === fieldId);
    return fieldDef?.type;
  }

  /**
   * Checks if a given operator is a "between" type, requiring two value inputs.
   * This method is passed as an input to the `FilterGroupComponent`.
   * @param {string | undefined} operator - The operator ID.
   * @returns {boolean} True if the operator is 'between' or 'betweenDates'.
   */
  isBetweenOperator = (operator: string | undefined): boolean => {
    return operator === 'between' || operator === 'betweenDates';
  }

  /**
   * Callback method invoked when the `FilterGroupComponent` (used for editing a rule) emits a change.
   * This typically happens when conditions or operators within the rule's filter group are modified.
   * Currently, it logs the change; can be expanded for auto-save or validation.
   */
  onRuleFilterGroupChanged(): void {
    // This is called when the child FilterGroupComponent emits a change.
    // this.editingRule.filterGroup is already updated via [(ngModel)] binding within FilterGroupComponent.
    // We might do validation or auto-save here if desired.
    console.log('Rule filter group changed in parent:', JSON.stringify(this.editingRule?.filterGroup));
    // No explicit save here; saving happens when the main "Save Rule" button is clicked.
  }

  // --- Data Fetch Methods ---

  /**
   * Saves the configured start date for fetching transaction data using `SimpleFinDataService`.
   * Shows an alert on success or failure.
   */
  saveDataFetchSettings(): void {
    if (this.dataFetchStartDate) {
      const parts = this.dataFetchStartDate.split('-'); // YYYY-MM-DD
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // JavaScript months are 0-indexed
      const day = parseInt(parts[2], 10);
      const newStartDate = new Date(year, month, day);

      if (!isNaN(newStartDate.getTime())) {
        this.dataService.setConfiguredStartDate(newStartDate);
        alert('Data fetch start date saved!');
      } else {
        alert('Invalid date selected for data fetch start.');
      }
    }
  }

  // --- Foldable Section Toggles ---
  // These methods toggle the boolean flags for section visibility and persist the state.

  /** Toggles the folded state of the "Manage Buckets" section and saves the state. */
  toggleManageBuckets(): void {
    this.manageBucketsFolded = !this.manageBucketsFolded;
    this.uiStateService.setFoldableState(UI_SETUP_MANAGE_BUCKETS_FOLDED, this.manageBucketsFolded);
  }
  /** Toggles the folded state of the "Manage Rules" section and saves the state. */
  toggleManageRules(): void {
    this.manageRulesFolded = !this.manageRulesFolded;
    this.uiStateService.setFoldableState(UI_SETUP_MANAGE_RULES_FOLDED, this.manageRulesFolded);
  }
  /** Toggles the folded state of the "Data Fetch Settings" section and saves the state. */
  toggleDataFetchSettings(): void {
    this.dataFetchSettingsFolded = !this.dataFetchSettingsFolded;
    this.uiStateService.setFoldableState(UI_SETUP_DATA_FETCH_FOLDED, this.dataFetchSettingsFolded);
  }
}

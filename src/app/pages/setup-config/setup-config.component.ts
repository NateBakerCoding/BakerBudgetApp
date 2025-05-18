// src/app/pages/setup-config/setup-config.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Bucket, Rule, FilterableField, StringOperator, NumericOperator, DateOperator,
  FilterCondition, FilterGroup, LogicalOperator,
  BucketGoal, GoalType, GoalTimePeriodType // Import new Goal models
} from '../../models/budget.model';
import { BudgetConfigService } from '../../services/budget-config.service';
import { SimpleFinDataService } from '../../services/simplefin-data.service';
import { UiStateService } from '../../services/ui-state.service';
import { FilterGroupComponent } from '../../components/filter-group/filter-group.component';

// Define constants for UI state IDs (ensure these are exactly as used in ngOnInit)
const UI_SETUP_MANAGE_BUCKETS_FOLDED = 'setupManageBucketsFolded';
const UI_SETUP_MANAGE_RULES_FOLDED = 'setupManageRulesFolded';
const UI_SETUP_DATA_FETCH_FOLDED = 'setupDataFetchFolded';

@Component({
  selector: 'app-setup-config',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterGroupComponent],
  templateUrl: './setup-config.component.html',
  styleUrls: ['./setup-config.component.css']
})
export class SetupConfigComponent implements OnInit {
  // --- Bucket Properties ---
  buckets: Bucket[] = [];
  formBucketName: string = '';
  formBucketPriority: number = 10;
  editingBucket: Bucket | null = null;
  selectedBucketForRules: Bucket | null = null;

  // --- Goal Properties for Bucket Form ---
  formBucketGoal: BucketGoal = this.createEmptyBucketGoal();

  // --- Rule Properties ---
  rules: Rule[] = [];
  formRuleName: string = '';
  editingRule: Rule | null = null;

  // --- Data Fetch Properties ---
  dataFetchStartDate: string = '';

  // --- Foldable State Properties ---
  manageBucketsFolded: boolean = true;
  manageRulesFolded: boolean = true;
  dataFetchSettingsFolded: boolean = true;

  // --- Enums/Lists for Template Dropdowns ---
  // Expose enums directly for more robust template comparisons
  public readonly GoalType = GoalType;
  public readonly GoalTimePeriodType = GoalTimePeriodType;

  public readonly goalTypeOptions = [
    { id: GoalType.SAVINGS, name: 'Savings Goal (Aim to accumulate)' },
    { id: GoalType.SPENDING_LIMIT, name: 'Spending Limit (Track expenses against a cap)' }
  ];
  public readonly goalTimePeriodTypeOptions = [
    { id: GoalTimePeriodType.CURRENT_MONTH, name: 'This Current Month' },
    { id: GoalTimePeriodType.ROLLING_DAYS, name: 'Rolling Last X Days' },
    { id: GoalTimePeriodType.FIXED_DATE_RANGE, name: 'Fixed Date Range' },
    { id: GoalTimePeriodType.CURRENT_YEAR, name: 'This Current Year' },
    { id: GoalTimePeriodType.ALL_TIME, name: 'All Time (since data start)' }
  ];

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
  public readonly stringOperators: Array<{ id: StringOperator, name: string }> = [
    { id: 'exactMatch', name: 'Exactly Matches' }, { id: 'contains', name: 'Contains' },
    { id: 'doesNotContain', name: 'Does Not Contain' }, { id: 'startsWith', name: 'Starts With' },
    { id: 'endsWith', name: 'Ends With' }, { id: 'regex', name: 'Matches Regex' }
  ];
  public readonly numberOperators: Array<{ id: NumericOperator, name: string }> = [
    { id: 'equalTo', name: 'Equal To (=)' }, { id: 'notEqualTo', name: 'Not Equal To (≠)' },
    { id: 'greaterThan', name: 'Greater Than (>)' }, { id: 'lessThan', name: 'Less Than (<)' },
    { id: 'greaterThanOrEqualTo', name: 'Greater Than or Equal To (≥)' },
    { id: 'lessThanOrEqualTo', name: 'Less Than or Equal To (≤)' },
    { id: 'between', name: 'Between (inclusive)' }
  ];
  public readonly dateOperators: Array<{ id: DateOperator, name: string }> = [
    { id: 'onDate', name: 'On Date' }, { id: 'beforeDate', name: 'Before Date' },
    { id: 'afterDate', name: 'After Date' }, { id: 'betweenDates', name: 'Between Dates (inclusive)' }
  ];
  public readonly datePartOperators: Array<{ id: Extract<NumericOperator, 'equalTo' | 'notEqualTo'>, name: string }> = [
    { id: 'equalTo', name: 'Is' }, { id: 'notEqualTo', name: 'Is Not' }
  ];
  public readonly timeStringOperators: Array<{ id: Extract<StringOperator, 'exactMatch'> , name: string }> = [
    { id: 'exactMatch', name: 'Exactly At (HH:MM)'}
  ];

  constructor(
    private budgetConfigService: BudgetConfigService,
    private dataService: SimpleFinDataService,
    private uiStateService: UiStateService
  ) {}

  async ngOnInit(): Promise<void> {
    this.loadBuckets();
    this.loadRules();
    this.resetBucketFormFields();
    this.resetRuleFormFields();

    const configuredDate = this.dataService.getConfiguredStartDate();
    this.dataFetchStartDate = configuredDate.toISOString().split('T')[0];

    this.manageBucketsFolded = await this.uiStateService.getFoldableState(UI_SETUP_MANAGE_BUCKETS_FOLDED, true);
    this.manageRulesFolded = await this.uiStateService.getFoldableState(UI_SETUP_MANAGE_RULES_FOLDED, true);
    this.dataFetchSettingsFolded = await this.uiStateService.getFoldableState(UI_SETUP_DATA_FETCH_FOLDED, true);
  }

  createEmptyBucketGoal(): BucketGoal {
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());

    return {
      isActive: false,
      targetAmount: 0,
      goalType: GoalType.SPENDING_LIMIT,
      periodType: GoalTimePeriodType.CURRENT_MONTH,
      rollingDays: 30,
      startDate: today.toISOString().split('T')[0],
      endDate: nextMonth.toISOString().split('T')[0]
    };
  }

  // --- Bucket Methods ---
  loadBuckets(): void { this.buckets = this.budgetConfigService.getBuckets(); }

  resetBucketFormFields(): void {
    this.formBucketName = '';
    const maxPriority = this.buckets.length > 0 ? Math.max(...this.buckets.map(b => b.priority)) : 0;
    this.formBucketPriority = maxPriority + 10;
    this.editingBucket = null;
    this.formBucketGoal = this.createEmptyBucketGoal();
  }

  submitBucketForm(): void {
    if (this.editingBucket) {
      this.saveEditBucket();
    } else {
      this.addBucket();
    }
  }

  addBucket(): void {
    if (this.formBucketName.trim() && this.formBucketPriority > 0) {
      const newBucketName = this.formBucketName.trim();
      const newBucketPriority = this.formBucketPriority;
      const newBucketGoal = this.formBucketGoal.isActive ? { ...this.formBucketGoal } : undefined;

      // Add bucket using service, which generates ID
      const tempBucket = this.budgetConfigService.addBucket(newBucketName, newBucketPriority);
      
      // If a goal was configured, update the newly created bucket with the goal
      if (tempBucket && newBucketGoal) {
        const bucketToUpdate: Bucket = {
            ...tempBucket, // This includes the ID generated by the service
            goal: newBucketGoal
        };
        this.budgetConfigService.updateBucket(bucketToUpdate);
      }

      this.loadBuckets(); // Reload to get the final list with updated bucket
      this.resetBucketFormFields();
    }
  }

  deleteBucket(bucketId: string): void {
    if (confirm('Are you sure you want to delete this bucket? Its rule associations will also be removed.')) {
      this.budgetConfigService.deleteBucket(bucketId); this.loadBuckets();
      if (this.editingBucket && this.editingBucket.id === bucketId) { this.resetBucketFormFields(); }
      if (this.selectedBucketForRules && this.selectedBucketForRules.id === bucketId) { this.selectedBucketForRules = null; }
    }
  }

  startEditBucket(bucket: Bucket): void {
    this.editingBucket = bucket;
    this.formBucketName = bucket.name;
    this.formBucketPriority = bucket.priority;
    this.formBucketGoal = bucket.goal ? JSON.parse(JSON.stringify(bucket.goal)) : this.createEmptyBucketGoal(); // Deep copy for goal
  }

  saveEditBucket(): void {
    if (this.editingBucket && this.formBucketName.trim() && this.formBucketPriority > 0) {
      const updatedBucketData: Bucket = {
        ...this.editingBucket,
        name: this.formBucketName.trim(),
        priority: this.formBucketPriority,
        goal: this.formBucketGoal.isActive ? { ...this.formBucketGoal } : undefined
      };
      this.budgetConfigService.updateBucket(updatedBucketData);
      this.loadBuckets();
      this.resetBucketFormFields();
    }
  }
  cancelEditBucket(): void { this.resetBucketFormFields(); }

  // --- Rule Methods ---
  loadRules(): void { this.rules = this.budgetConfigService.getRules(); }
  resetRuleFormFields(): void { this.formRuleName = ''; this.editingRule = null; }

  submitRuleForm(): void {
    if (this.editingRule) {
      if (this.formRuleName.trim()) {
        this.editingRule.name = this.formRuleName.trim();
        this.budgetConfigService.updateRule(this.editingRule);
        this.loadRules();
        this.resetRuleFormFields();
      }
    } else {
      this.addRule();
    }
  }
  addRule(): void {
    if (this.formRuleName.trim()) {
      this.budgetConfigService.addRule(this.formRuleName.trim()); this.loadRules(); this.resetRuleFormFields();
    }
  }
  startEditRule(rule: Rule): void {
    this.editingRule = JSON.parse(JSON.stringify(rule));
    if (this.editingRule) {
        this.formRuleName = this.editingRule.name;
    } else {
        this.resetRuleFormFields();
    }
  }
  deleteRule(ruleId: string): void {
    if (confirm('Are you sure? This will remove the rule from all buckets.')) {
      this.budgetConfigService.deleteRule(ruleId); this.loadRules(); this.loadBuckets();
      if (this.editingRule && this.editingRule.id === ruleId) { this.resetRuleFormFields(); }
    }
  }
  cancelEditRule(): void { this.resetRuleFormFields(); }

  // --- Linking Rules to Buckets ---
  openBucketRuleConfig(bucket: Bucket): void { this.selectedBucketForRules = bucket; }
  closeBucketRuleConfig(): void { this.selectedBucketForRules = null; }
  isRuleInBucket(ruleId: string): boolean {
    if (!this.selectedBucketForRules) return false;
    return this.selectedBucketForRules.rules.some((br: { ruleId: string; isActive: boolean }) => br.ruleId === ruleId);
  }
  toggleRuleForBucket(ruleId: string, event: Event): void {
    if (!this.selectedBucketForRules) return;
    const target = event.target as HTMLInputElement; const isChecked = target.checked;
    let newRulesArray = [...this.selectedBucketForRules.rules];
    const existingRuleIndex = newRulesArray.findIndex((br: { ruleId: string; isActive: boolean }) => br.ruleId === ruleId);
    if (isChecked && existingRuleIndex === -1) { newRulesArray.push({ ruleId: ruleId, isActive: true }); }
    else if (!isChecked && existingRuleIndex > -1) { newRulesArray.splice(existingRuleIndex, 1); }
    const updatedBucket: Bucket = { ...this.selectedBucketForRules, rules: newRulesArray };
    this.budgetConfigService.updateBucket(updatedBucket); this.selectedBucketForRules = updatedBucket; this.loadBuckets();
  }
  isRuleActiveInBucket(ruleId: string): boolean {
    if (!this.selectedBucketForRules) return false;
    const bucketRule = this.selectedBucketForRules.rules.find((br: { ruleId: string; isActive: boolean }) => br.ruleId === ruleId);
    return bucketRule ? bucketRule.isActive : false;
  }
  toggleRuleActiveState(ruleId: string, event: Event): void {
    if (!this.selectedBucketForRules) return;
    const target = event.target as HTMLInputElement; const isActive = target.checked; let ruleUpdated = false;
    const newRulesArray = this.selectedBucketForRules.rules.map((br: { ruleId: string; isActive: boolean }) => {
      if (br.ruleId === ruleId) { ruleUpdated = true; return { ...br, isActive: isActive }; } return br;
    });
    if (ruleUpdated) {
      const updatedBucket: Bucket = { ...this.selectedBucketForRules, rules: newRulesArray };
      this.budgetConfigService.updateBucket(updatedBucket); this.selectedBucketForRules = updatedBucket;
    }
  }

  // --- Rule Configurator Helpers ---
  getOperatorsForField(fieldId: FilterableField | undefined): any[] {
    if (!fieldId) return []; const fieldDef = this.filterableFieldsList.find(f => f.id === fieldId); if (!fieldDef) return [];
    switch (fieldDef.type) {
      case 'string': return this.stringOperators; case 'number': return this.numberOperators;
      case 'date': return this.dateOperators; case 'datePart': return this.datePartOperators;
      case 'timeString': return this.timeStringOperators; default: return [];
    }
  }
  getFieldType(fieldId: FilterableField | undefined): string | undefined {
    const fieldDef = this.filterableFieldsList.find(f => f.id === fieldId); return fieldDef?.type;
  }
  isBetweenOperator(operator: string | undefined): boolean { return operator === 'between' || operator === 'betweenDates'; }
  onRuleFilterGroupChanged(): void { console.log('Rule filter group changed:', JSON.stringify(this.editingRule?.filterGroup)); }

  // --- Data Fetch Methods ---
  saveDataFetchSettings(): void {
    if (this.dataFetchStartDate) {
      const parts = this.dataFetchStartDate.split('-'); const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; const day = parseInt(parts[2], 10);
      const newStartDate = new Date(year, month, day);
      if (!isNaN(newStartDate.getTime())) { this.dataService.setConfiguredStartDate(newStartDate); alert('Data fetch start date saved!'); }
      else { alert('Invalid date selected for data fetch start.'); }
    }
  }

  // --- Foldable Section Toggles ---
  toggleManageBuckets(): void { this.manageBucketsFolded = !this.manageBucketsFolded; this.uiStateService.setFoldableState(UI_SETUP_MANAGE_BUCKETS_FOLDED, this.manageBucketsFolded); }
  toggleManageRules(): void { this.manageRulesFolded = !this.manageRulesFolded; this.uiStateService.setFoldableState(UI_SETUP_MANAGE_RULES_FOLDED, this.manageRulesFolded); }
  toggleDataFetchSettings(): void { this.dataFetchSettingsFolded = !this.dataFetchSettingsFolded; this.uiStateService.setFoldableState(UI_SETUP_DATA_FETCH_FOLDED, this.dataFetchSettingsFolded); }
}

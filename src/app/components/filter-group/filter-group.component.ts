import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FilterGroup, FilterCondition, LogicalOperator, FilterableField } from '../../models/budget.model';
import { BudgetConfigService } from '../../services/budget-config.service'; // For creating empty conditions/groups

@Component({
  selector: 'app-filter-group',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterGroupComponent], // Import itself for recursion
  templateUrl: './filter-group.component.html',
  styleUrls: ['./filter-group.component.css']
})
export class FilterGroupComponent implements OnInit {
  @Input() filterGroup!: FilterGroup;
  @Input() depth: number = 0; // For indentation and visual hierarchy

  // To pass field/operator definitions down from parent (SetupConfigComponent)
  @Input() filterableFieldsList: Array<{ id: FilterableField, name: string, type: string, part?: string }> = [];
  @Input() getOperatorsForField!: (fieldId: FilterableField | undefined) => any[];
  @Input() getFieldType!: (fieldId: FilterableField | undefined) => string | undefined;
  @Input() isBetweenOperator!: (operator: string | undefined) => boolean;

  @Output() groupChanged = new EventEmitter<void>(); // Emit when anything in this group changes

  logicalOperators: LogicalOperator[] = ['AND', 'OR'];

  constructor(private budgetConfigService: BudgetConfigService) {}

  ngOnInit(): void {
    if (!this.filterGroup) {
      // Initialize with a default if not provided (should not happen if used correctly)
      this.filterGroup = this.budgetConfigService.createEmptyFilterGroup();
      console.warn('FilterGroupComponent initialized with no input filterGroup.');
    }
  }

  onGroupOperatorChange(): void {
    this.notifyChange();
  }

  addCondition(): void {
    this.filterGroup.conditions.push(this.budgetConfigService.createEmptyFilterCondition());
    this.notifyChange();
  }

  removeCondition(index: number): void {
    this.filterGroup.conditions.splice(index, 1);
    this.notifyChange();
  }

  onConditionChange(): void { // Called by ngModelChange on condition fields
    this.notifyChange();
  }

  addSubGroup(): void {
    this.filterGroup.subGroups.push(this.budgetConfigService.createEmptyFilterGroup());
    this.notifyChange();
  }

  removeSubGroup(index: number): void {
    this.filterGroup.subGroups.splice(index, 1);
    this.notifyChange();
  }

  // This method is called when a child FilterGroupComponent emits a change
  onSubGroupChanged(): void {
    this.notifyChange(); // Propagate the change upwards
  }

  // Helper to ensure the operators list is fresh when a field changes
  getOperators(fieldId: FilterableField | undefined): any[] {
    return this.getOperatorsForField ? this.getOperatorsForField(fieldId) : [];
  }

  getFieldInputType(fieldId: FilterableField | undefined): string {
      const fieldType = this.getFieldType ? this.getFieldType(fieldId) : 'text';
      if (fieldType === 'date') return 'date';
      if (fieldType === 'number') return 'number';
      // Add more specific types like 'time' if needed for timeString
      return 'text';
  }

  isFieldNumeric(fieldId: FilterableField | undefined): boolean {
      return this.getFieldType ? this.getFieldType(fieldId) === 'number' : false;
  }

  notifyChange(): void {
    this.groupChanged.emit();
  }
}

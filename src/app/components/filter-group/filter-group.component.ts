import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FilterGroup, FilterCondition, LogicalOperator, FilterableField } from '../../models/budget.model';
import { BudgetConfigService } from '../../services/budget-config.service';

/**
 * FilterGroupComponent is a recursive component used to build and display a rule's filter criteria.
 * It allows users to define a hierarchical structure of conditions and logical operators (AND/OR)
 * to match transactions. Each instance can contain multiple conditions and/or nested sub-groups.
 */
@Component({
  selector: 'app-filter-group',
  standalone: true,
  imports: [CommonModule, FormsModule, FilterGroupComponent], // Import itself for recursion
  templateUrl: './filter-group.component.html',
  styleUrls: ['./filter-group.component.css']
})
export class FilterGroupComponent implements OnInit {
  /** The main FilterGroup object this component instance manages. */
  @Input() filterGroup!: FilterGroup;
  /** The current depth of this filter group in the hierarchy, used for visual indentation. */
  @Input() depth: number = 0;

  // --- Configuration Inputs from Parent (SetupConfigComponent) ---
  /** List of available fields that can be used in conditions. */
  @Input() filterableFieldsList: Array<{ id: FilterableField, name: string, type: string, part?: string }> = [];
  /** Function to get the list of applicable operators for a given filterable field. */
  @Input() getOperatorsForField!: (fieldId: FilterableField | undefined) => any[];
  /** Function to get the data type (e.g., 'string', 'number', 'date') of a filterable field. */
  @Input() getFieldType!: (fieldId: FilterableField | undefined) => string | undefined;
  /** Function to check if a given operator is a 'between' type operator, requiring two input values. */
  @Input() isBetweenOperator!: (operator: string | undefined) => boolean;
  // --- End Configuration Inputs ---

  /** Emits an event whenever any part of this filter group (operator, conditions, sub-groups, names) changes. */
  @Output() groupChanged = new EventEmitter<void>();

  logicalOperators: LogicalOperator[] = ['AND', 'OR'];

  constructor(private budgetConfigService: BudgetConfigService) {}

  ngOnInit(): void {
    if (!this.filterGroup) {
      // Initialize with a default if not provided. This is a safeguard;
      // the component expects filterGroup to be supplied by its parent.
      this.filterGroup = this.budgetConfigService.createEmptyFilterGroup();
      console.warn('FilterGroupComponent initialized with no input filterGroup. This may indicate an issue.');
    }
  }

  /**
   * Handles changes to the filter group's name.
   * Notifies the parent component about the change.
   */
  onGroupNameChange(): void {
    this.notifyChange();
  }

  /**
   * Handles changes to the filter group's logical operator (AND/OR).
   * Notifies the parent component about the change.
   */
  onGroupOperatorChange(): void {
    this.notifyChange();
  }

  /**
   * Adds a new, empty filter condition to the current group.
   * Notifies the parent component about the change.
   */
  addCondition(): void {
    this.filterGroup.conditions.push(this.budgetConfigService.createEmptyFilterCondition());
    this.notifyChange();
  }

  /**
   * Removes a filter condition from the current group at the specified index.
   * @param index The index of the condition to remove.
   */
  removeCondition(index: number): void {
    this.filterGroup.conditions.splice(index, 1);
    this.notifyChange();
  }

  /**
   * Handles changes to any part of a filter condition (field, operator, value, name).
   * This is typically called by ngModelChange on condition input fields.
   * Notifies the parent component about the change.
   */
  onConditionChange(): void {
    this.notifyChange();
  }

  /**
   * Handles changes to a filter condition's name.
   * Notifies the parent component about the change.
   */
  onConditionNameChange(): void {
    this.notifyChange();
  }

  /**
   * Adds a new, empty sub-filter group to the current group.
   * Notifies the parent component about the change.
   */
  addSubGroup(): void {
    this.filterGroup.subGroups.push(this.budgetConfigService.createEmptyFilterGroup());
    this.notifyChange();
  }

  /**
   * Removes a sub-filter group from the current group at the specified index.
   * @param index The index of the sub-group to remove.
   */
  removeSubGroup(index: number): void {
    this.filterGroup.subGroups.splice(index, 1);
    this.notifyChange();
  }

  /**
   * Handles the 'groupChanged' event emitted by a child FilterGroupComponent.
   * This ensures that changes in nested sub-groups are propagated up to the top-level parent.
   */
  onSubGroupChanged(): void {
    this.notifyChange(); // Propagate the change upwards
  }

  /**
   * Retrieves the list of operators applicable to the specified filterable field.
   * This is a helper method used in the template.
   * @param fieldId The ID of the filterable field.
   * @returns An array of operator definitions.
   */
  getOperators(fieldId: FilterableField | undefined): any[] {
    return this.getOperatorsForField ? this.getOperatorsForField(fieldId) : [];
  }

  /**
   * Determines the appropriate HTML input type for a given filterable field.
   * (e.g., 'date' for date fields, 'number' for numeric fields).
   * This is a helper method used in the template.
   * @param fieldId The ID of the filterable field.
   * @returns A string representing the HTML input type.
   */
  getFieldInputType(fieldId: FilterableField | undefined): string {
      const fieldType = this.getFieldType ? this.getFieldType(fieldId) : 'text';
      if (fieldType === 'date') return 'date';
      if (fieldType === 'number') return 'number';
      // Could add more specific types like 'time' if needed for timeString fields
      return 'text';
  }

  /**
   * Checks if a filterable field is of a numeric type.
   * This is a helper method used in the template, for example, to show/hide the 'Use Absolute Amount' checkbox.
   * @param fieldId The ID of the filterable field.
   * @returns True if the field is numeric, false otherwise.
   */
  isFieldNumeric(fieldId: FilterableField | undefined): boolean {
      return this.getFieldType ? this.getFieldType(fieldId) === 'number' : false;
  }

  /**
   * Emits the `groupChanged` event to notify parent components of a modification
   * within this filter group or any of its children.
   */
  private notifyChange(): void {
    this.groupChanged.emit();
  }
}

// src/app/services/rule-engine.service.ts
import { Injectable } from '@angular/core';
import { ProcessedTransaction } from '../models/budget.model';
import { Rule, FilterGroup, FilterCondition, FilterableField, StringOperator, NumericOperator, DateOperator } from '../models/budget.model';

@Injectable({
  providedIn: 'root'
})
export class RuleEngineService {

  constructor() { }

  public evaluateTransactionAgainstRule(transaction: ProcessedTransaction, rule: Rule): boolean {
    if (!rule || !rule.filterGroup) {
      return false; // Or handle as an error/log
    }
    return this.evaluateFilterGroup(transaction, rule.filterGroup);
  }

  private evaluateFilterGroup(transaction: ProcessedTransaction, group: FilterGroup): boolean {
    if (!group) return false; // Should not happen with valid rule structure

    // Evaluate conditions first
    let conditionsResult: boolean;
    if (group.conditions && group.conditions.length > 0) {
      if (group.operator === 'AND') {
        conditionsResult = group.conditions.every(condition => this.evaluateCondition(transaction, condition));
      } else { // OR
        conditionsResult = group.conditions.some(condition => this.evaluateCondition(transaction, condition));
      }
    } else {
      // No conditions in this group. If 'AND', it's vacuously true *so far*. If 'OR', it's false *so far*.
      // The result will then depend on subgroups.
      conditionsResult = (group.operator === 'AND');
    }

    // If there are no subgroups, the result is based purely on conditions.
    if (!group.subGroups || group.subGroups.length === 0) {
      return conditionsResult;
    }

    // Evaluate subgroups
    let subGroupsResult: boolean;
    if (group.operator === 'AND') {
      // If conditions already failed an AND group, no need to check subgroups.
      if (!conditionsResult) return false;
      subGroupsResult = group.subGroups.every(subGroup => this.evaluateFilterGroup(transaction, subGroup));
    } else { // OR
      // If conditions already satisfied an OR group, no need to check subgroups.
      if (conditionsResult) return true;
      subGroupsResult = group.subGroups.some(subGroup => this.evaluateFilterGroup(transaction, subGroup));
    }
    return subGroupsResult; // This line is correct. If AND, both conditionsResult (which was true) and subGroupsResult must be true. If OR, one of them must have been true.
  }


  private evaluateCondition(transaction: ProcessedTransaction, condition: FilterCondition): boolean {
    if (!transaction || !condition || !condition.field || !condition.operator) {
      return false;
    }

    const txValue = this.getTransactionValue(transaction, condition.field);
    let filterValue = condition.value;
    let filterValue2 = condition.value2; // For 'between'

    if (txValue === undefined || txValue === null) {
        // Handle cases where the transaction field might be missing.
        // If operator is 'doesNotContain' or 'notEqualTo' and filterValue is something,
        // it might be considered a match if the field is truly absent.
        // For simplicity now, if txValue is null/undefined, most conditions will fail unless specifically designed for it.
        if (condition.operator === 'notEqualTo' && filterValue === null) return true; // txValue is null AND filterValue is null
        if (condition.operator === 'equalTo' && filterValue === null) return true; // txValue is null AND filterValue is null
        return false;
    }


    // Handle absolute amount for numeric fields
    let numericTxValue = typeof txValue === 'number' ? txValue : NaN;
    if (condition.useAbsoluteAmount && typeof txValue === 'number') {
      numericTxValue = Math.abs(txValue);
    }

    try {
      switch (condition.operator as StringOperator | NumericOperator | DateOperator) {
        // String Operators
        case 'exactMatch':
          return String(txValue).toLowerCase() === String(filterValue).toLowerCase();
        case 'contains':
          return String(txValue).toLowerCase().includes(String(filterValue).toLowerCase());
        case 'doesNotContain':
          return !String(txValue).toLowerCase().includes(String(filterValue).toLowerCase());
        case 'startsWith':
          return String(txValue).toLowerCase().startsWith(String(filterValue).toLowerCase());
        case 'endsWith':
          return String(txValue).toLowerCase().endsWith(String(filterValue).toLowerCase());
        case 'regex':
          return new RegExp(String(filterValue)).test(String(txValue));

        // Numeric Operators
        case 'equalTo':
          // For dateParts and amounts. datePart is already a number.
          return condition.useAbsoluteAmount ? numericTxValue === parseFloat(filterValue) : txValue === parseFloat(filterValue) || txValue === filterValue; // txValue could be number from datepart
        case 'notEqualTo':
          return condition.useAbsoluteAmount ? numericTxValue !== parseFloat(filterValue) : txValue !== parseFloat(filterValue) && txValue !== filterValue;
        case 'greaterThan':
          return numericTxValue > parseFloat(filterValue);
        case 'lessThan':
          return numericTxValue < parseFloat(filterValue);
        case 'greaterThanOrEqualTo':
          return numericTxValue >= parseFloat(filterValue);
        case 'lessThanOrEqualTo':
          return numericTxValue <= parseFloat(filterValue);
        case 'between':
          return numericTxValue >= parseFloat(filterValue) && numericTxValue <= parseFloat(filterValue2);

        // Date Operators (value is YYYY-MM-DD string)
        case 'onDate': {
          const txDate = this.normalizeToDateOnly(txValue as Date);
          const filterDate = this.normalizeToDateOnly(new Date(String(filterValue) + "T00:00:00Z")); // Ensure parsing as local then UTC for consistency with date picker
          return txDate?.getTime() === filterDate?.getTime();
        }
        case 'beforeDate': {
          const txDate = this.normalizeToDateOnly(txValue as Date);
          const filterDate = this.normalizeToDateOnly(new Date(String(filterValue) + "T00:00:00Z"));
          return txDate !== null && filterDate !== null && txDate.getTime() < filterDate.getTime();
        }
        case 'afterDate': {
          const txDate = this.normalizeToDateOnly(txValue as Date);
          const filterDate = this.normalizeToDateOnly(new Date(String(filterValue) + "T00:00:00Z"));
          return txDate !== null && filterDate !== null && txDate.getTime() > filterDate.getTime();
        }
        case 'betweenDates': {
          const txDate = this.normalizeToDateOnly(txValue as Date);
          const filterDateStart = this.normalizeToDateOnly(new Date(String(filterValue) + "T00:00:00Z"));
          const filterDateEnd = this.normalizeToDateOnly(new Date(String(filterValue2) + "T00:00:00Z"));
          return txDate !== null && filterDateStart !== null && filterDateEnd !== null &&
                 txDate.getTime() >= filterDateStart.getTime() && txDate.getTime() <= filterDateEnd.getTime();
        }
        // Note: DatePart operators like 'onDayOfWeek' are handled by 'equalTo'/'notEqualTo' as txValue will be a number.
        default:
          console.warn(`Unknown operator: ${condition.operator}`);
          return false;
      }
    } catch (e) {
        console.error("Error evaluating condition:", e, condition, "txValue:", txValue);
        return false;
    }
  }

  private getTransactionValue(transaction: ProcessedTransaction, field: FilterableField): any {
    const postedDate = new Date(transaction.posted * 1000); // Common for date parts

    switch (field) {
      case 'payeeName': return transaction.payee;
      case 'descriptionText': return transaction.description;
      case 'orgName': return transaction.orgName;
      case 'accountName': return transaction.accountName;
      case 'amountTransacted': return transaction.amountNum;
      case 'balanceBefore': return transaction.balanceBefore;
      case 'balanceAfter': return transaction.balanceAfter;
      case 'dayOfWeek': return postedDate.getDay(); // 0 (Sun) - 6 (Sat)
      case 'weekOfMonth': return this.getWeekOfMonth(postedDate);
      case 'monthOfYear': return postedDate.getMonth(); // 0 (Jan) - 11 (Dec)
      case 'transactionTime': // HH:MM format
        const hours = postedDate.getHours().toString().padStart(2, '0');
        const minutes = postedDate.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
      case 'postedDate': // For direct date comparisons
        return postedDate;
      default:
        console.warn(`Unknown transaction field: ${field}`);
        return undefined;
    }
  }

  private getWeekOfMonth(date: Date): number {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    // Align day to the first day of the week (e.g. Sunday)
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    // Get year start
    const yearStart = new Date(d.getFullYear(), 0, 1);
    // Calculate full weeks to nearest Thursday
    const weekNumber = Math.ceil((((d.valueOf() - yearStart.valueOf()) / 86400000) + 1) / 7);
    
    // This is ISO week number. For "week of month":
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const dayOfWeekForFirst = firstDayOfMonth.getDay(); // 0 for Sunday
    const dateInMonth = date.getDate();
    return Math.ceil((dateInMonth + dayOfWeekForFirst) / 7);
  }
  
  private normalizeToDateOnly(dateInput: Date | string | number | undefined | null): Date | null {
      if (dateInput === undefined || dateInput === null) return null;
      try {
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return null; // Invalid date
        date.setHours(0, 0, 0, 0); // Normalize to start of day
        return date;
      } catch (e) {
        return null;
      }
  }
}

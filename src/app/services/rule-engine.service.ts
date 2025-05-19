// src/app/services/rule-engine.service.ts
import { Injectable } from '@angular/core';
import { ProcessedTransaction } from '../models/budget.model';
import { Rule, FilterGroup, FilterCondition, FilterableField, StringOperator, NumericOperator, DateOperator, LogicalOperator } from '../models/budget.model';

/**
 * RuleEngineService is responsible for evaluating financial transactions against a set of user-defined rules.
 * Each rule can be composed of multiple conditions and groups of conditions, combined using logical operators (AND/OR).
 * The service determines if a transaction matches a given rule based on these criteria.
 */
@Injectable({
  providedIn: 'root'
})
export class RuleEngineService {

  constructor() { }

  /**
   * Main entry point for evaluating a transaction against a complete rule.
   * A rule consists of a top-level filter group.
   * @param transaction The transaction to evaluate.
   * @param rule The rule to evaluate against.
   * @returns True if the transaction matches the rule, false otherwise.
   */
  public evaluateTransactionAgainstRule(transaction: ProcessedTransaction, rule: Rule): boolean {
    if (!rule || !rule.filterGroup) {
      console.warn("Invalid rule or filterGroup provided to evaluateTransactionAgainstRule", rule);
      return false;
    }
    return this.evaluateFilterGroup(transaction, rule.filterGroup);
  }

  /**
   * Evaluates a transaction against a filter group.
   * This method is recursive: a filter group can contain conditions and/or other sub-groups.
   *
   * Order of Evaluation:
   * 1. Conditions directly within this group are evaluated first.
   * 2. Sub-groups are evaluated next.
   *
   * Logic for AND operator:
   * - If direct conditions exist and any condition is false, the group evaluates to false.
   * - If all direct conditions are true (or if there are no direct conditions, which is vacuously true),
   *   then all sub-groups must also evaluate to true. If any sub-group is false, the group is false.
   *
   * Logic for OR operator:
   * - If direct conditions exist and any condition is true, the group evaluates to true.
   * - If all direct conditions are false (or if there are no direct conditions, which is vacuously false),
   *   then at least one sub-group must evaluate to true. If all sub-groups are false, the group is false.
   *
   * @param transaction The transaction to evaluate.
   * @param group The filter group to evaluate.
   * @returns True if the transaction matches the filter group's logic, false otherwise.
   */
  private evaluateFilterGroup(transaction: ProcessedTransaction, group: FilterGroup): boolean {
    if (!group) {
      console.warn("Invalid group provided to evaluateFilterGroup");
      return false; // Should not happen with a valid rule structure
    }

    let conditionsMet: boolean;
    if (group.conditions && group.conditions.length > 0) {
      // Evaluate conditions within the current group
      if (group.operator === 'AND') {
        conditionsMet = group.conditions.every(condition => this.evaluateCondition(transaction, condition));
      } else { // OR
        conditionsMet = group.conditions.some(condition => this.evaluateCondition(transaction, condition));
      }
    } else {
      // If there are no conditions in this group:
      // - For an AND group, this part is considered "vacuously true" because there are no conditions to fail.
      // - For an OR group, this part is considered "vacuously false" because there are no conditions to satisfy.
      // The final result will then depend on the subGroups.
      conditionsMet = (group.operator === 'AND');
    }

    // Determine outcome based on conditions and operator, potentially short-circuiting
    if (group.operator === 'AND') {
      if (!conditionsMet) {
        return false; // If AND conditions are not met, the whole group is false.
      }
      // If conditionsMet is true (or vacuously true), AND group result depends on subGroups.
    } else { // OR
      if (conditionsMet) {
        return true; // If OR conditions are met, the whole group is true.
      }
      // If conditionsMet is false (or vacuously false), OR group result depends on subGroups.
    }

    // If there are no subGroups, the result is solely based on conditionsMet
    if (!group.subGroups || group.subGroups.length === 0) {
      return conditionsMet;
    }

    // Evaluate subGroups if necessary
    if (group.operator === 'AND') {
      // All subGroups must be true for the AND group to be true.
      // (We already know conditionsMet was true from above)
      return group.subGroups.every(subGroup => this.evaluateFilterGroup(transaction, subGroup));
    } else { // OR
      // At least one subGroup must be true for the OR group to be true.
      // (We already know conditionsMet was false from above)
      return group.subGroups.some(subGroup => this.evaluateFilterGroup(transaction, subGroup));
    }
  }

  /**
   * Evaluates a single condition against a transaction field.
   * It retrieves the relevant value from the transaction, handles type conversions,
   * and applies the specified operator.
   * `useAbsoluteAmount` is a flag relevant for numeric comparisons, indicating whether
   * the absolute value of the transaction amount should be used.
   *
   * @param transaction The transaction data.
   * @param condition The filter condition to evaluate.
   * @returns True if the condition is met, false otherwise.
   */
  private evaluateCondition(transaction: ProcessedTransaction, condition: FilterCondition): boolean {
    if (!transaction || !condition || !condition.field || !condition.operator) {
      console.warn("Invalid arguments for evaluateCondition", { transaction, condition });
      return false;
    }

    const txValue = this.getTransactionValue(transaction, condition.field);

    // Handle cases where the transaction field might be missing (null or undefined).
    // Specific operators might treat nulls differently.
    if (txValue === undefined || txValue === null) {
      if (condition.operator === 'notEqualTo' && condition.value === null) return true; // txValue is null AND filterValue is null (null is not notEqualTo null -> false, this seems off)
                                                                                      // Correction: (null !== null) is false. If condition.value is null, then (txValue !== null) is false.
                                                                                      // If condition.value is something else, (null !== something) is true.
      if (condition.operator === 'equalTo' && condition.value === null) return true;    // (null === null) is true.
      // For most other operators, a null/undefined txValue means the condition cannot be met unless specifically handled by operator.
      // Example: 'doesNotContain' could be true if the field is null and value is not null.
      // However, current string/numeric/date helpers assume non-null txValue.
      // For now, if txValue is null and not handled by above, it's false.
      if (condition.operator === 'doesNotContain' && condition.value !== null) return true; // If field is null, it doesn't contain a non-null value.
      return false;
    }

    // Prepare numeric value if absolute amount is to be used.
    // This is passed to evaluateNumericCondition.
    let numericTxValueForEval = typeof txValue === 'number' ? txValue : NaN;
    if (condition.useAbsoluteAmount && typeof txValue === 'number') {
      numericTxValueForEval = Math.abs(txValue);
    }

    try {
      // Delegate to type-specific handlers based on operator type
      // This requires knowing which operators are string, numeric, or date.
      // We can infer from the operator value itself.

      const stringOps: StringOperator[] = ['exactMatch', 'contains', 'doesNotContain', 'startsWith', 'endsWith', 'regex'];
      const numericOps: NumericOperator[] = ['equalTo', 'notEqualTo', 'greaterThan', 'lessThan', 'greaterThanOrEqualTo', 'lessThanOrEqualTo', 'between'];
      const dateOps: DateOperator[] = ['onDate', 'beforeDate', 'afterDate', 'betweenDates']; // 'onDayOfWeek', 'inWeekOfMonth', 'inMonthOfYear' are handled by numeric as they become numbers

      if (stringOps.includes(condition.operator as StringOperator)) {
        return this.evaluateStringCondition(txValue, condition);
      } else if (numericOps.includes(condition.operator as NumericOperator)) {
         // Note: 'equalTo' and 'notEqualTo' can also be used for date part numbers (dayOfWeek, monthOfYear)
         // In these cases, txValue is already a number, and numericTxValueForEval will be the same unless useAbsoluteAmount is true (which is unlikely for date parts).
        return this.evaluateNumericCondition(numericTxValueForEval, txValue, condition);
      } else if (dateOps.includes(condition.operator as DateOperator)) {
        return this.evaluateDateCondition(txValue, condition);
      } else {
        // Fallback for operators that might not be categorized yet (e.g. date part specific operators if not treated as numeric)
        // However, 'onDayOfWeek', 'inWeekOfMonth', 'inMonthOfYear' from FilterableField result in numeric txValues from getTransactionValue
        // and should be handled by evaluateNumericCondition with 'equalTo', 'notEqualTo' etc.
        console.warn(`Unknown or uncategorized operator: ${condition.operator}`);
        return false;
      }
    } catch (e) {
        console.error("Error evaluating condition:", e, { condition, txValue });
        return false;
    }
  }

  /**
   * Evaluates string-based filter conditions.
   * @param txValue The actual value from the transaction field.
   * @param condition The filter condition.
   * @returns True if the condition is met, false otherwise.
   */
  private evaluateStringCondition(txValue: any, condition: FilterCondition): boolean {
    const filterValue = String(condition.value); // Ensure filterValue is a string
    const transactionStringValue = String(txValue); // Ensure txValue is treated as a string

    switch (condition.operator as StringOperator) {
      case 'exactMatch':
        return transactionStringValue.toLowerCase() === filterValue.toLowerCase();
      case 'contains':
        return transactionStringValue.toLowerCase().includes(filterValue.toLowerCase());
      case 'doesNotContain':
        // This was already partially handled in evaluateCondition for null txValue,
        // but if txValue is not null, this is the correct logic.
        return !transactionStringValue.toLowerCase().includes(filterValue.toLowerCase());
      case 'startsWith':
        return transactionStringValue.toLowerCase().startsWith(filterValue.toLowerCase());
      case 'endsWith':
        return transactionStringValue.toLowerCase().endsWith(filterValue.toLowerCase());
      case 'regex':
        try {
          return new RegExp(filterValue).test(transactionStringValue);
        } catch (e) {
          console.error("Invalid regex:", filterValue, e);
          return false;
        }
      default:
        console.warn(`Unknown string operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Evaluates numeric filter conditions.
   * @param numericTxValue The transaction value, potentially transformed by Math.abs() if condition.useAbsoluteAmount is true.
   *                       This is used for direct numeric comparisons (amount, balance).
   * @param originalTxValue The original transaction value, before Math.abs(). This is useful for fields that are inherently numeric
   *                        but not monetary (e.g., dayOfWeek, monthOfYear) where useAbsoluteAmount is not applicable or intended.
   * @param condition The filter condition, containing the operator and value(s) to compare against.
   * @returns True if the condition is met, false otherwise.
   */
  private evaluateNumericCondition(numericTxValue: number, originalTxValue: any, condition: FilterCondition): boolean {
    const filterVal = parseFloat(String(condition.value));
    const filterVal2 = condition.value2 !== undefined ? parseFloat(String(condition.value2)) : undefined;

    // Determine which transaction value to use:
    // If useAbsoluteAmount is true, numericTxValue (which is already Math.abs(originalAmount)) should be used.
    // If useAbsoluteAmount is false, or if the originalTxValue is not the one that useAbsoluteAmount applies to (e.g. date parts),
    // then we should use originalTxValue if it's a number, or numericTxValue if it's derived from an amount.
    // The key is that `numericTxValue` is `Math.abs(txValue)` if `useAbsoluteAmount` and `txValue` is number, otherwise it's `txValue` or `NaN`.
    // `originalTxValue` is always the direct value from `getTransactionValue`.

    // For fields like 'dayOfWeek', 'monthOfYear', 'amountTransacted':
    // - getTransactionValue returns a number.
    // - If condition.field is 'amountTransacted' and useAbsoluteAmount is true, numericTxValue is abs(amount).
    // - If condition.field is 'dayOfWeek', useAbsoluteAmount is likely false/irrelevant. numericTxValue would be same as originalTxValue.

    // Let's simplify: the `numericTxValue` passed in has already handled `useAbsoluteAmount`.
    // For non-amount fields (like date parts), `originalTxValue` is the direct number (e.g., 3 for Wednesday).
    // `numericTxValue` would be the same if `useAbsoluteAmount` wasn't specifically requested for that field type.

    const valueToCompare = condition.useAbsoluteAmount && (condition.field === 'amountTransacted' || condition.field === 'balanceAfter' || condition.field === 'balanceBefore')
                           ? numericTxValue // This is already Math.abs(original amount)
                           : typeof originalTxValue === 'number' ? originalTxValue : numericTxValue; // Use original if it's a number (date parts), else the processed numericTxValue

    if (isNaN(valueToCompare)) {
        // This can happen if originalTxValue was not a number and couldn't be parsed,
        // or if numericTxValue was NaN initially.
        return false;
    }
    if (isNaN(filterVal)) {
        console.warn("Filter value is not a number:", condition.value);
        return false;
    }


    switch (condition.operator as NumericOperator) {
      case 'equalTo':
        // Handles both direct number comparison and parsed floats.
        // originalTxValue might be a number (e.g. from datepart), so direct comparison is also checked.
        return valueToCompare === filterVal;
      case 'notEqualTo':
        return valueToCompare !== filterVal;
      case 'greaterThan':
        return valueToCompare > filterVal;
      case 'lessThan':
        return valueToCompare < filterVal;
      case 'greaterThanOrEqualTo':
        return valueToCompare >= filterVal;
      case 'lessThanOrEqualTo':
        return valueToCompare <= filterVal;
      case 'between':
        if (filterVal2 === undefined || isNaN(filterVal2)) {
            console.warn("Second filter value for 'between' is missing or not a number:", condition.value2);
            return false;
        }
        return valueToCompare >= filterVal && valueToCompare <= filterVal2;
      default:
        console.warn(`Unknown numeric operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Evaluates date-based filter conditions.
   * @param txValue The actual value from the transaction field (should be a Date object or parsable into one).
   * @param condition The filter condition.
   * @returns True if the condition is met, false otherwise.
   */
  private evaluateDateCondition(txValue: any, condition: FilterCondition): boolean {
    const txDate = this.normalizeToDateOnly(txValue as Date | string | number); // getTransactionValue for 'postedDate' returns Date object
    if (!txDate) {
      console.warn("Invalid transaction date for date condition", txValue);
      return false;
    }

    // Filter values for dates are expected to be YYYY-MM-DD strings.
    // Add "T00:00:00Z" to ensure they are parsed as UTC midnight, then normalized.
    // This aligns with how a date picker might store/send dates without timezones.
    const filterDate1 = this.normalizeToDateOnly(condition.value ? new Date(String(condition.value) + "T00:00:00Z") : null);
    const filterDate2 = condition.value2 ? this.normalizeToDateOnly(new Date(String(condition.value2) + "T00:00:00Z")) : null;

    if (!filterDate1 && (condition.operator !== 'equalTo' && condition.operator !== 'notEqualTo')) { // Allow null comparison for equalTo/notEqualTo
         // If first filter date is invalid for most operations, condition fails
        if (!(condition.operator === 'equalTo' && condition.value === null) && !(condition.operator === 'notEqualTo' && condition.value === null)){
            console.warn("Invalid primary filter date for date condition", condition.value);
            return false;
        }
    }


    switch (condition.operator as DateOperator) {
      case 'onDate':
        if (!filterDate1) return false;
        return txDate.getTime() === filterDate1.getTime();
      case 'beforeDate':
        if (!filterDate1) return false;
        return txDate.getTime() < filterDate1.getTime();
      case 'afterDate':
        if (!filterDate1) return false;
        return txDate.getTime() > filterDate1.getTime();
      case 'betweenDates':
        if (!filterDate1 || !filterDate2) {
          console.warn("Invalid date range for 'betweenDates' condition", { value1: condition.value, value2: condition.value2 });
          return false;
        }
        return txDate.getTime() >= filterDate1.getTime() && txDate.getTime() <= filterDate2.getTime();
      // Note: 'onDayOfWeek', 'inWeekOfMonth', 'inMonthOfYear' are not handled here.
      // They are converted to numbers by getTransactionValue and evaluated by evaluateNumericCondition.
      default:
        console.warn(`Unknown date operator: ${condition.operator}`);
        return false;
    }
  }


  /**
   * Retrieves a value from a transaction based on the specified field.
   * This method may also transform the data into a more usable format for evaluation
   * (e.g., extracting date parts like day of week, month, or formatting time).
   * @param transaction The transaction object.
   * @param field The specific field to retrieve from the transaction.
   * @returns The value of the field, possibly transformed. Returns undefined if the field is unknown.
   */
  private getTransactionValue(transaction: ProcessedTransaction, field: FilterableField): any {
    // Common case: transaction.posted is a Unix timestamp (seconds). Convert to milliseconds for JS Date.
    const postedDate = new Date(transaction.posted * 1000);

    switch (field) {
      // Direct string/number properties
      case 'payeeName': return transaction.payee; // Could be undefined
      case 'descriptionText': return transaction.description;
      case 'orgName': return transaction.orgName;
      case 'accountName': return transaction.accountName;
      case 'amountTransacted': return transaction.amountNum; // This is a number
      case 'balanceBefore': return transaction.balanceBefore; // Could be undefined
      case 'balanceAfter': return transaction.balanceAfter; // Could be undefined

      // Date-derived numeric parts
      case 'dayOfWeek': return postedDate.getDay(); // 0 (Sunday) - 6 (Saturday)
      case 'weekOfMonth': return this.getWeekOfMonth(postedDate); // Custom logic, returns a number
      case 'monthOfYear': return postedDate.getMonth(); // 0 (January) - 11 (December)

      // Date-derived string part
      case 'transactionTime': // Returns HH:MM string
        const hours = postedDate.getHours().toString().padStart(2, '0');
        const minutes = postedDate.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;

      // Full date object for direct date comparisons
      case 'postedDate':
        return postedDate; // Returns a Date object

      default:
        // Log a warning for any unhandled field. This helps in identifying gaps or typos in FilterableField definitions.
        console.warn(`Unknown transaction field requested: ${field}`);
        return undefined;
    }
  }

  /**
   * Calculates the week of the month for a given date.
   * Example: If the 1st of the month is a Wednesday, then the 1st-4th would be week 1 (assuming Sunday start).
   * The 5th (Sunday) would start week 2.
   * This specific implementation calculates it based on the day of the month and the day of the week of the first day of that month.
   * @param date The date for which to calculate the week of the month.
   * @returns The week number within the month (e.g., 1, 2, 3, 4, 5).
   */
  private getWeekOfMonth(date: Date): number {
    // Get the date (1-31)
    const dateInMonth = date.getDate();
    // Get the first day of the current month
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    // Get the day of the week for the first day of the month (0 for Sunday, 1 for Monday, etc.)
    const dayOfWeekForFirst = firstDayOfMonth.getDay();
    
    // Calculate week of month: (date + day of week of 1st of month - 1) / 7, then ceiling.
    // E.g. date = 1st, firstDay is Wed (3). (1 + 3 -1) = 3. 3/7 = 0.42 -> ceil(0.42) = 1st week. (Incorrect logic)
    // A common approach:
    // Math.ceil((dateInMonth + firstDayOfMonth.getDay()) / 7)
    // If 1st is Sunday (0), date 1 -> Math.ceil((1+0)/7) = 1. Date 7 -> Math.ceil((7+0)/7) = 1. Date 8 -> Math.ceil((8+0)/7) = 2.
    // If 1st is Saturday (6), date 1 -> Math.ceil((1+6)/7) = 1. Date 2 -> Math.ceil((2+6)/7) = 2.
    return Math.ceil((dateInMonth + dayOfWeekForFirst) / 7);
  }
  
  /**
   * Normalizes a given date input (which can be a Date object, string, or number)
   * into a Date object set to midnight (00:00:00.000) in the local timezone.
   * This is crucial for "whole day" comparisons, ensuring that two dates on the same calendar day
   * are considered equal, regardless of their time components.
   * @param dateInput The date to normalize. Can be a Date object, or a string/number parsable by `new Date()`.
   * @returns A new Date object representing the start of the given date (local time), or null if the input is invalid.
   */
  private normalizeToDateOnly(dateInput: Date | string | number | undefined | null): Date | null {
      if (dateInput === undefined || dateInput === null) {
        // console.debug("normalizeToDateOnly received null or undefined input");
        return null;
      }
      try {
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) { // Check if the date is valid
          // console.warn("normalizeToDateOnly received an invalid date input:", dateInput);
          return null;
        }
        // Normalize to start of the day in local time.
        // This means if dateInput was a string like "2023-01-15" (meant as a specific day, not UTC midnight),
        // new Date("2023-01-15") might parse it as UTC midnight or local midnight depending on string format and browser.
        // "YYYY-MM-DD" is parsed as UTC midnight. "YYYY/MM/DD" is local.
        // To be safe, especially if input is already a Date object that might have time:
        date.setHours(0, 0, 0, 0);
        return date;
      } catch (e) {
        // console.error("Error in normalizeToDateOnly:", e, "Input:", dateInput);
        return null;
      }
  }
}

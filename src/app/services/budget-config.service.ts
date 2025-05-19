// src/app/services/budget-config.service.ts
import { Injectable } from '@angular/core';
import { Bucket, Rule, FilterGroup, FilterCondition, LogicalOperator } from '../models/budget.model';

/** localStorage key for storing bucket configurations. */
const BUCKETS_STORAGE_KEY = 'budgetApp_buckets';
/** localStorage key for storing rule configurations. */
const RULES_STORAGE_KEY = 'budgetApp_rules';

/**
 * BudgetConfigService manages the configuration of budget buckets and rules.
 * It handles CRUD (Create, Read, Update, Delete) operations for both buckets and rules,
 * persisting them to the browser's localStorage. This service ensures that
 * budget configurations are loaded upon application start and saved whenever changes are made.
 */
@Injectable({
  providedIn: 'root'
})
export class BudgetConfigService {
  private buckets: Bucket[] = [];
  private rules: Rule[] = [];

  constructor() {
    this.loadBuckets();
    this.loadRules();
  }

  // --- Bucket Management ---

  /**
   * Loads buckets from localStorage and sorts them by priority.
   * This method is called during service initialization.
   */
  private loadBuckets(): void {
    const storedBuckets = localStorage.getItem(BUCKETS_STORAGE_KEY);
    this.buckets = storedBuckets ? JSON.parse(storedBuckets) : [];
    // Ensure buckets are always sorted by priority after loading or modification.
    this.buckets.sort((a,b) => a.priority - b.priority);
  }

  /**
   * Saves the current state of buckets to localStorage.
   * Buckets are sorted by priority before saving.
   */
  private saveBuckets(): void {
    this.buckets.sort((a,b) => a.priority - b.priority);
    localStorage.setItem(BUCKETS_STORAGE_KEY, JSON.stringify(this.buckets));
  }

  /**
   * Retrieves a copy of all configured buckets, sorted by priority.
   * @returns {Bucket[]} An array of all buckets.
   */
  getBuckets(): Bucket[] {
    return [...this.buckets]; // Return a copy to prevent direct modification
  }

  /**
   * Finds a specific bucket by its ID.
   * @param {string} id - The ID of the bucket to retrieve.
   * @returns {Bucket | undefined} The found bucket, or undefined if not found.
   */
  getBucketById(id: string): Bucket | undefined {
    return this.buckets.find(b => b.id === id);
  }

  /**
   * Adds a new bucket to the configuration.
   * A unique ID is generated for the new bucket.
   * @param {string} name - The name for the new bucket.
   * @param {number} priority - The priority for sorting and rule application.
   * @returns {Bucket} The newly created bucket.
   */
  addBucket(name: string, priority: number): Bucket {
    const newBucket: Bucket = {
      id: crypto.randomUUID(), // Generate a unique ID
      name,
      priority,
      rules: [] // Initialize with an empty array of rule associations
    };
    this.buckets.push(newBucket);
    this.saveBuckets();
    return newBucket;
  }

  /**
   * Updates an existing bucket.
   * Finds the bucket by ID and replaces it with the updated version.
   * @param {Bucket} updatedBucket - The bucket object with updated properties.
   */
  updateBucket(updatedBucket: Bucket): void {
    const index = this.buckets.findIndex(b => b.id === updatedBucket.id);
    if (index > -1) {
      this.buckets[index] = updatedBucket;
      this.saveBuckets();
    }
  }

  /**
   * Deletes a bucket by its ID.
   * @param {string} bucketId - The ID of the bucket to delete.
   */
  deleteBucket(bucketId: string): void {
    this.buckets = this.buckets.filter(b => b.id !== bucketId);
    // Note: Rule definitions themselves are not deleted here, only their association if any.
    // Buckets store references to rules; deleting a bucket doesn't delete the global rule.
    this.saveBuckets();
  }

  // --- Rule Management ---

  /**
   * Loads rules from localStorage.
   * This method is called during service initialization.
   */
  private loadRules(): void {
    const storedRules = localStorage.getItem(RULES_STORAGE_KEY);
    this.rules = storedRules ? JSON.parse(storedRules) : [];
  }

  /**
   * Saves the current state of rules to localStorage.
   */
  private saveRules(): void {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(this.rules));
  }

  /**
   * Retrieves a copy of all configured rules.
   * @returns {Rule[]} An array of all rules.
   */
  getRules(): Rule[] {
    return [...this.rules]; // Return a copy
  }

  /**
   * Finds a specific rule by its ID.
   * @param {string} id - The ID of the rule to retrieve.
   * @returns {Rule | undefined} The found rule, or undefined if not found.
   */
  getRuleById(id: string): Rule | undefined {
    return this.rules.find(r => r.id === id);
  }

  /**
   * Adds a new rule to the configuration.
   * A unique ID is generated, and it's initialized with a default top-level filter group.
   * @param {string} name - The name for the new rule.
   * @param {LogicalOperator} [initialOperator='AND'] - The initial logical operator for the rule's top-level filter group.
   * @returns {Rule} The newly created rule.
   */
  addRule(name: string, initialOperator: LogicalOperator = 'AND'): Rule {
    const newRule: Rule = {
      id: crypto.randomUUID(),
      name,
      filterGroup: { // Default empty top-level filter group
        id: crypto.randomUUID(), // Unique ID for this specific filter group instance
        operator: initialOperator,
        conditions: [],
        subGroups: []
      }
    };
    this.rules.push(newRule);
    this.saveRules();
    return newRule;
  }

  /**
   * Updates an existing rule.
   * Finds the rule by ID and replaces it with the updated version.
   * @param {Rule} updatedRule - The rule object with updated properties.
   */
  updateRule(updatedRule: Rule): void {
    const index = this.rules.findIndex(r => r.id === updatedRule.id);
    if (index > -1) {
      this.rules[index] = updatedRule;
      this.saveRules();
    }
  }

  /**
   * Deletes a rule by its ID.
   * Also removes any associations of this rule from all buckets.
   * @param {string} ruleId - The ID of the rule to delete.
   */
  deleteRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
    // Remove this rule from any buckets that are using it
    this.buckets.forEach(bucket => {
      bucket.rules = bucket.rules.filter(br => br.ruleId !== ruleId);
    });
    this.saveBuckets(); // Save changes to buckets due to rule removal
    this.saveRules();
  }

  // --- Helper Methods for UI ---

  /**
   * Creates an empty `FilterCondition` object with default values.
   * Useful for initializing new conditions in the UI.
   * @returns {FilterCondition} A new filter condition object.
   */
  createEmptyFilterCondition(): FilterCondition {
    return {
      id: crypto.randomUUID(),
      // name: '', // Optional name for the condition, can be added by user
      field: 'payeeName', // Default field for a new condition
      operator: 'contains', // Default operator
      value: ''
    };
  }

  /**
   * Creates an empty `FilterGroup` object with a specified logical operator.
   * Useful for initializing new filter groups (including sub-groups) in the UI.
   * @param {LogicalOperator} [operator='AND'] - The logical operator for the new filter group.
   * @returns {FilterGroup} A new filter group object.
   */
  createEmptyFilterGroup(operator: LogicalOperator = 'AND'): FilterGroup {
    return {
      id: crypto.randomUUID(),
      operator: operator,
      conditions: [],
      subGroups: []
    };
  }
}

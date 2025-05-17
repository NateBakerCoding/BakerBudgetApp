// src/app/services/budget-config.service.ts
import { Injectable } from '@angular/core';
import { Bucket, Rule, FilterGroup, FilterCondition, LogicalOperator } from '../models/budget.model'; // Ensure all are imported

const BUCKETS_STORAGE_KEY = 'budgetApp_buckets';
const RULES_STORAGE_KEY = 'budgetApp_rules'; // New key for rules

@Injectable({
  providedIn: 'root'
})
export class BudgetConfigService {
  private buckets: Bucket[] = [];
  private rules: Rule[] = []; // Store for rules

  constructor() {
    this.loadBuckets();
    this.loadRules(); // Load rules on init
  }

  // --- Bucket Management (existing methods) ---
  private loadBuckets(): void {
    const storedBuckets = localStorage.getItem(BUCKETS_STORAGE_KEY);
    this.buckets = storedBuckets ? JSON.parse(storedBuckets) : [];
    this.buckets.sort((a,b) => a.priority - b.priority); // Ensure sorted
  }

  private saveBuckets(): void {
    this.buckets.sort((a,b) => a.priority - b.priority);
    localStorage.setItem(BUCKETS_STORAGE_KEY, JSON.stringify(this.buckets));
  }

  getBuckets(): Bucket[] {
    return [...this.buckets];
  }

  getBucketById(id: string): Bucket | undefined {
    return this.buckets.find(b => b.id === id);
  }

  addBucket(name: string, priority: number): Bucket {
    const newBucket: Bucket = {
      id: crypto.randomUUID(),
      name,
      priority,
      rules: [] // Initialize with no rules linked
    };
    this.buckets.push(newBucket);
    this.saveBuckets();
    return newBucket;
  }

  updateBucket(updatedBucket: Bucket): void {
    const index = this.buckets.findIndex(b => b.id === updatedBucket.id);
    if (index > -1) {
      this.buckets[index] = updatedBucket;
      this.saveBuckets();
    }
  }

  deleteBucket(bucketId: string): void {
    this.buckets = this.buckets.filter(b => b.id !== bucketId);
    // Also remove this bucket's rules associations (or handle orphaned rules if rules are global)
    // For now, rules are global, so just save buckets.
    this.saveBuckets();
  }

  // --- Rule Management (New Methods) ---
  private loadRules(): void {
    const storedRules = localStorage.getItem(RULES_STORAGE_KEY);
    this.rules = storedRules ? JSON.parse(storedRules) : [];
  }

  private saveRules(): void {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(this.rules));
  }

  getRules(): Rule[] {
    return [...this.rules]; // Return a copy
  }

  getRuleById(id: string): Rule | undefined {
    return this.rules.find(r => r.id === id);
  }

  addRule(name: string, initialOperator: LogicalOperator = 'AND'): Rule {
    const newRule: Rule = {
      id: crypto.randomUUID(),
      name,
      filterGroup: { // Default empty top-level filter group
        id: crypto.randomUUID(), // ID for this specific group instance
        operator: initialOperator,
        conditions: [],
        subGroups: []
      }
    };
    this.rules.push(newRule);
    this.saveRules();
    return newRule;
  }

  updateRule(updatedRule: Rule): void {
    const index = this.rules.findIndex(r => r.id === updatedRule.id);
    if (index > -1) {
      this.rules[index] = updatedRule;
      this.saveRules();
    }
  }

  deleteRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
    // Also, remove this rule from any buckets that are using it
    this.buckets.forEach(bucket => {
      bucket.rules = bucket.rules.filter(br => br.ruleId !== ruleId);
    });
    this.saveBuckets(); // Save changes to buckets
    this.saveRules();
  }

  // Helper to create a new FilterCondition (used by UI)
  createEmptyFilterCondition(): FilterCondition {
    return {
      id: crypto.randomUUID(),
      // name: '', // Optional name for the condition itself
      field: 'payeeName', // Default field
      operator: 'contains', // Default operator
      value: ''
    };
  }

  // Helper to create a new FilterGroup (used by UI)
  createEmptyFilterGroup(operator: LogicalOperator = 'AND'): FilterGroup {
    return {
      id: crypto.randomUUID(),
      operator: operator,
      conditions: [],
      subGroups: []
    };
  }
}

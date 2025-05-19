// src/app/services/ui-state.service.ts
import { Injectable } from '@angular/core';
import { db, UiElementState } from './transaction-db.service';

/**
 * UiStateService provides methods to manage and persist the state of UI elements,
 * such as whether a section is folded (collapsed) or unfolded (expanded).
 * It uses the `TransactionDB` (Dexie) service to store these states, allowing them
 * to persist across application sessions.
 */
@Injectable({
  providedIn: 'root'
})
export class UiStateService {

  constructor() { }

  /**
   * Retrieves the persisted folded state for a given UI element.
   * If no state is found for the element, it returns the provided default value.
   * @param {string} elementId - The unique identifier for the UI element whose state is being retrieved
   *                             (e.g., 'dashboardAccountSummaryFolded').
   * @param {boolean} defaultValue - The default folded state to return if no persisted state is found.
   * @returns {Promise<boolean>} A promise that resolves to the persisted folded state or the default value.
   */
  async getFoldableState(elementId: string, defaultValue: boolean): Promise<boolean> {
    try {
      const state = await db.uiStates.get(elementId);
      return state ? state.isFolded : defaultValue;
    } catch (error) {
      console.error(`Error getting UI state for ${elementId} from Dexie:`, error);
      return defaultValue; // Return default on error to ensure UI consistency
    }
  }

  /**
   * Persists the folded state for a given UI element.
   * @param {string} elementId - The unique identifier for the UI element whose state is being set
   *                             (e.g., 'dashboardAccountSummaryFolded').
   * @param {boolean} isFolded - The folded state to persist (true for folded, false for unfolded).
   * @returns {Promise<void>} A promise that resolves when the state has been saved.
   */
  async setFoldableState(elementId: string, isFolded: boolean): Promise<void> {
    try {
      const state: UiElementState = { id: elementId, isFolded };
      await db.uiStates.put(state); // 'put' will add or update the record
    } catch (error) {
      console.error(`Error setting UI state for ${elementId} in Dexie:`, error);
      // Depending on requirements, might re-throw or handle more gracefully.
    }
  }

  /**
   * Clears all persisted UI states from the database.
   * This can be useful for a full application reset or debugging purposes.
   * @returns {Promise<void>} A promise that resolves when all UI states have been cleared.
   */
  async clearAllUiStates(): Promise<void> {
    try {
      await db.uiStates.clear();
      console.log('All UI states cleared from Dexie DB.');
    } catch (error) {
      console.error('Error clearing UI states from Dexie:', error);
    }
  }
}

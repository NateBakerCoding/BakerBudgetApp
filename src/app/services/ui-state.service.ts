// src/app/services/ui-state.service.ts
import { Injectable } from '@angular/core';
import { db, UiElementState } from './transaction-db.service'; // Import Dexie db instance

@Injectable({
  providedIn: 'root'
})
export class UiStateService {

  constructor() { }

  async getFoldableState(elementId: string, defaultValue: boolean): Promise<boolean> {
    try {
      const state = await db.uiStates.get(elementId);
      return state ? state.isFolded : defaultValue;
    } catch (error) {
      console.error(`Error getting UI state for ${elementId}:`, error);
      return defaultValue; // Return default on error
    }
  }

  async setFoldableState(elementId: string, isFolded: boolean): Promise<void> {
    try {
      const state: UiElementState = { id: elementId, isFolded };
      await db.uiStates.put(state);
    } catch (error) {
      console.error(`Error setting UI state for ${elementId}:`, error);
    }
  }

  // Helper for clearing states if needed during full app reset, etc.
  async clearAllUiStates(): Promise<void> {
    try {
      await db.uiStates.clear();
      console.log('All UI states cleared from DB.');
    } catch (error) {
      console.error('Error clearing UI states:', error);
    }
  }
}

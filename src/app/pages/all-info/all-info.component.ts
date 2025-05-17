// src/app/pages/all-info/all-info.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SimpleFinDataService } from '../../services/simplefin-data.service';
import { Account, ProcessedTransaction } from '../../models/budget.model';
import { UnixToDatePipe } from '../../unix-to-date.pipe';

@Component({
  selector: 'app-all-info',
  standalone: true,
  imports: [CommonModule, FormsModule, UnixToDatePipe],
  templateUrl: './all-info.component.html',
  styleUrls: ['./all-info.component.css']
})
export class AllInfoComponent implements OnInit, OnDestroy {
  setupToken: string = '';
  // startDate input is removed from this component

  accounts: Account[] = [];
  allTransactions: ProcessedTransaction[] = [];
  isLoading: boolean = false;
  errorMessage: string | null = null;
  hasStoredAccessDetails: boolean = false;

  // For displaying debug info from the service
  get claimUrlForDisplay(): string { return this.dataService.claimUrlForDisplay; }
  get rawAccessUrlForDisplay(): string { return this.dataService.rawAccessUrl; }
  get parsedBaseUrlForDisplay(): string { return this.dataService.parsedBaseUrl; }
  get authHeaderForDisplay(): string | null { return this.dataService.authHeaderForDisplay; }

  private subscriptions = new Subscription();

  constructor(public dataService: SimpleFinDataService) {} // Service is public for template access

  ngOnInit(): void {
    this.subscriptions.add(this.dataService.accounts$.subscribe(accs => this.accounts = accs));
    this.subscriptions.add(this.dataService.transactions$.subscribe(txs => this.allTransactions = txs));
    this.subscriptions.add(this.dataService.isLoading$.subscribe(loading => this.isLoading = loading));
    this.subscriptions.add(this.dataService.errorMessage$.subscribe(err => this.errorMessage = err));
    this.subscriptions.add(
      this.dataService.hasStoredAccessDetails$.subscribe(
        (hasDetails: boolean) => (this.hasStoredAccessDetails = hasDetails)
      )
    );

    // Initial data load/check is handled by the service's constructor or autoUpdateDataIfNeeded
    // If this page is loaded and data hasn't been fetched yet, autoUpdateDataIfNeeded in service should run.
    // If you want to force a check every time this page is shown:
    // if (this.dataService.hasStoredAccessDetails) {
    //   this.dataService.autoUpdateDataIfNeeded(false).catch(e => console.error(e));
    // }
  }

  handleDataOperation(): void {
    // this.errorMessage = null; // Service handles error messages
    if (this.hasStoredAccessDetails) {
      // Trigger a force update, which will use the globally configured start date from the service
      this.dataService.autoUpdateDataIfNeeded(true).catch(err => {
        console.error('Force update failed from AllInfoComponent', err);
        // Service should have already set an error message via errorMessage$
      });
    } else if (this.setupToken.trim()) {
      this.dataService.claimAndFetchData(this.setupToken).subscribe({
        // Optional: handle component-specific success/error actions if needed
        error: (err) => {
          console.error('Claim and fetch data failed from AllInfoComponent', err);
          // Service already sets errorMessage$
        }
      });
    } else {
      // If service doesn't set an error for this, set one locally or rely on service
      this.dataService.errorMessageSubject.next("Please enter a setup token.");
    }
  }

  clearAccessDetails(): void {
    this.dataService.clearStoredAccessDetails();
    this.setupToken = '';
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}

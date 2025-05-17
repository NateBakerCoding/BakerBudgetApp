// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { SetupConfigComponent } from './pages/setup-config/setup-config.component';
import { AllInfoComponent } from './pages/all-info/all-info.component';

export const routes: Routes = [
  { path: 'dashboard', component: DashboardComponent, title: 'Budget Dashboard' },
  { path: 'setup', component: SetupConfigComponent, title: 'Setup & Configuration' },
  { path: 'all-info', component: AllInfoComponent, title: 'All SimpleFin Info' },
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' }, // Default route
  { path: '**', redirectTo: '/dashboard' } // Wildcard route
];

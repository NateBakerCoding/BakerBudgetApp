import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router'; // Import router directives

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,    // For <router-outlet>
    RouterLink,      // For routerLink
    RouterLinkActive // For routerLinkActive
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'] // We'll add styles for the nav
})
export class AppComponent {
  title = 'SimpleFin Budgeter'; // Or your preferred app title
}

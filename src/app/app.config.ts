import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router'; // If you have routes

// Import provideHttpClient and potentially withFetch for fetch-based backend requests
import { provideHttpClient, withFetch } from '@angular/common/http';

// import { routes } from './app.routes'; // If you have routes

export const appConfig: ApplicationConfig = {
  providers: [
    // provideRouter(routes), // Uncomment if you have routes
    provideHttpClient(withFetch()) // Add this to provide HttpClient globally
                                   // withFetch() enables the fetch API for backend, common for new projects
  ]
};

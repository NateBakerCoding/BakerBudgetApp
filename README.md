
# BakerBudgetApp

BakerBudgetApp is an Angular-based web application designed for personal budgeting using financial data from SimpleFin. It allows users to connect to their SimpleFin accounts, view transactions, and categorize them into custom "buckets" using a flexible rule engine. The app also supports setting and tracking financial goals for each bucket.

## Features

* **SimpleFin Integration:** Securely connect to your SimpleFin service to fetch account and transaction data.
* **Transaction Viewing:** Display all transactions from linked accounts with details like payee, description, amount, and dates.
* **Customizable Buckets:** Create and manage "buckets" (e.g., Groceries, Entertainment, Savings) to categorize spending and income.
* **Powerful Rule Engine:**
    * Define rules using various transaction attributes (payee, description, amount, date parts, etc.).
    * Combine multiple conditions within a rule using AND/OR logic.
    * Nest filter groups for complex rule structures.
    * Assign rules to buckets with priorities to control categorization order.
* **Goal Setting:**
    * Define savings or spending limit goals for each bucket.
    * Track progress towards goals over various time periods (current month, rolling days, fixed date range, current year, all time).
* **Dashboard Overview:**
    * View account summaries and balances.
    * See an overview of each budget bucket, including total amount and transaction count.
    * Visualize goal progress with progress bars and remaining amounts.
    * Expand buckets to view categorized transactions.
* **Local Data Persistence:**
    * Uses Dexie.js (IndexedDB wrapper) to store SimpleFin access details (securely, after initial claim), transaction data, account information, bucket configurations, rules, and UI preferences. This allows for faster load times and offline viewing of previously fetched data.
* **Configurable Data History:** Set a default start date for how far back transaction data should be fetched.
* **Responsive Design:** Styled with a Catppuccin-inspired theme for a pleasant user experience.

## Tech Stack

* **Angular (v19+)**: Frontend framework.
* **TypeScript**: Primary programming language.
* **Dexie.js**: For IndexedDB interaction and local data storage.
* **SimpleFin API**: For fetching financial data.
* **Catppuccin Theme**: Styling based on the Mocha palette.

## Project Structure

* **`src/app/components`**: Reusable UI components (e.g., `filter-group`).
* **`src/app/models`**: TypeScript interfaces and types for data structures (e.g., `budget.model.ts`).
* **`src/app/pages`**: Main view components for different routes (e.g., `dashboard`, `setup-config`, `all-info`).
* **`src/app/services`**: Core logic and data management services:
    * `simplefin-data.service.ts`: Handles SimpleFin API communication and data fetching/caching.
    * `budget-config.service.ts`: Manages CRUD operations for buckets and rules.
    * `rule-engine.service.ts`: Evaluates transactions against defined rules.
    * `transaction-db.service.ts`: Defines the Dexie database schema.
    * `ui-state.service.ts`: Manages persistence of UI element states (e.g., foldable sections).
* **`src/app/pipes`**: Custom Angular pipes (e.g., `unix-to-date.pipe.ts`).

## Prerequisites

* Node.js (version specified in `package.json` engines or latest LTS recommended)
* Angular CLI (version specified in `package.json` devDependencies)
* A SimpleFin account and a one-time setup token from [SimpleFin Bridge](https://bridge.simplefin.org/) (or your SimpleFin provider).

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/natebakercoding/bakerbudgetapp.git
    cd bakerbudgetapp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    ng serve
    ```
    Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory. Use the `--configuration production` flag for a production build.

```bash
ng build --configuration production
````

## Usage

1.  **Initial Setup (Raw Data Page):**

      * Navigate to the "Raw Data" page.
      * If it's your first time, you'll be prompted to enter a "One-Time Setup Token" from SimpleFin. This token is used to claim an access URL.
      * Once the token is entered and processed, the app will fetch your financial data.
      * Your SimpleFin access URL (and authentication if applicable) will be stored locally in your browser's IndexedDB for future sessions.
      * You can clear these stored details at any time from the "Raw Data" page if needed.

2.  **Configure Data Fetch Range (Setup/Config Page):**

      * Go to the "Setup/Config" page.
      * Under "Data Fetch Settings," you can set a "Fetch Data Starting From" date. This determines how far back the application will request transaction history during full data refreshes or initial setup.

3.  **Create Rules (Setup/Config Page):**

      * Under "Manage Rules," define global rules for categorizing transactions.
      * Give each rule a name (e.g., "Groceries," "Gas").
      * Configure the filter conditions for each rule using the filter builder. You can specify fields (like Payee Name, Description, Amount), operators (contains, equals, greater than), and values.
      * Rules can have multiple conditions and nested groups combined with AND/OR logic.

4.  **Create Buckets (Setup/Config Page):**

      * Under "Manage Buckets," create your budget categories (e.g., "Food," "Utilities," "Savings").
      * Assign a name and a priority (lower number means higher priority for rule processing).
      * Optionally, configure a financial goal for each bucket (e.g., save $500 this month, limit spending to $200 in the last 30 days).

5.  **Link Rules to Buckets (Setup/Config Page):**

      * After creating buckets and rules, click "Configure Rules" for a specific bucket.
      * Check the rules you want to apply to that bucket.
      * Toggle whether each linked rule is "Active in this bucket." Transactions will be assigned to the highest priority bucket whose active rules they match.

6.  **View Dashboard:**

      * Navigate to the "Dashboard" page.
      * See a summary of your account balances.
      * View your configured buckets, the total amount of transactions categorized into them, and progress towards any set goals.
      * Expand buckets to see the list of transactions assigned to them.
      * Uncategorized transactions will appear in a special "Uncategorized Transactions" bucket.

## Key Features in Development (from `TODO.txt`)

The `TODO.txt` file outlines plans for further development, including:

  * [X] **Advanced Filter Options:**
      * Time-based filters (Day of week, Week of month, Month of year, Transaction Time).
      * Org-based filters (Org Name).
      * Account-based filters (Account Name).
      * Payee-based filters (Payee Name).
      * Description-based filters (Description Text).
      * Amount-based filters (Amount Transacted).
      * Balance-based filters (Balance Before/After transaction).
  * [X] **Enhanced Filter Operators:**
      * Date ranges, before/after specific times.
      * String matching options (exact, contains, starts with, ends with, regex).
      * Money-related field options (exact, range, greater/less than, absolute value modifiers).
  * [ ] **Filter Chaining & Grouping:** More complex logic gates like `(filter1 OR filter2) AND (filter3 OR filter4)`. (Partially implemented via nested filter groups).
  * [ ] **Naming for Filters and Rules:** (Rules have names, individual filters within a rule do not yet).
  * [X] **Filter/Rule Bank:** For easy copying and reuse. (Implemented)
  * [ ] **Priority System for Buckets/Rules:** (Bucket priority implemented, rule priority within a bucket is implicit by order of processing, could be made explicit).
  * [X] **Active/Inactive Rules per Bucket:** (Implemented).
  * [X] **CRUD for Buckets:** (Implemented).
  * [ ] **Dashboard Enhancements:** (Current dashboard shows account summary, buckets, and transactions. Further enhancements planned).

## Contributing

This is a personal project. Contributions, suggestions, and feedback are welcome\! Please feel free to open an issue or submit a pull request.

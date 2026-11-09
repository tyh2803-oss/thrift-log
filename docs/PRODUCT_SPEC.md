# THRIFT LOG
## Complete Codex Development Specification
### Reselling Business Management & Analytics PWA

# 1. Your Role and Mission

You are a senior full-stack engineer, product designer, database architect, and technical lead.

Your task is to build **Thrift Log**, a polished, fully functional progressive web application (PWA) for a single clothing reseller.

The user buys secondhand clothing from thrift stores, Goodwill Bins, and other sourcing locations, then resells it through:

- Depop
- Vinted
- eBay
- Whatnot, including approximately weekly livestream selling shows
- Occasional other in-person sales events

Thrift Log should centralize inventory, marketplace listings, sales, finances, sourcing, live shows, time tracking, and performance analytics.

The ultimate objective is to answer three questions:

1. **How much money am I making?**
2. **How much time am I investing, and what am I earning per hour?**
3. **What should I do differently to make more money with less effort?**

This is a private application built for one person, not a commercial SaaS product.

Prioritize simplicity, reliability, financial accuracy, low operating costs, and practical day-to-day usability.

**Build the actual working application. Do not stop at planning, mockups, or placeholder interfaces.**

If the repository is empty, initialize the project. Otherwise, inspect the codebase and preserve useful existing work.

---

# 2. CRITICAL REQUIREMENT: Simplicity Without Sacrificing Features

This application has many features, but **it must never feel overwhelming, cluttered, complicated, or difficult to navigate.**

This is one of the most important requirements.

The user should not feel like he is operating complicated accounting software or an enterprise inventory system.

He should feel like he is using an exceptionally well-designed personal business dashboard.

## Design philosophy

**Simple on the surface, powerful underneath.**

Build comprehensive functionality while intelligently organizing, hiding, and prioritizing features.

Follow these principles:

1. Show the most relevant information first.
2. Use progressive disclosure: reveal advanced tools only when useful.
3. Avoid creating separate navigation pages for every minor feature.
4. Use contextual actions instead of excessive menus.
5. Minimize unnecessary clicks.
6. Avoid making users fill out large forms.
7. Use smart defaults.
8. Automatically populate information wherever possible.
9. Make secondary information available through expandable sections, detail panels, and tabs.
10. Keep essential actions accessible from anywhere.
11. Avoid redundant metrics and duplicate functionality.
12. Use clean, readable visualizations instead of overwhelming tables.
13. Favor automation over manual entry.
14. Preserve advanced functionality without requiring the user to interact with it.
15. Design around workflows, not around database tables.

## Information architecture

Use five primary navigation destinations:

### 1. Home

An overview of the entire business, recent activity, important alerts, and key performance metrics.

### 2. Inventory

All physical inventory, listings, product records, purchase costs, and item-level management.

### 3. Sales

Orders, marketplace activity, transactions, fulfillment, Whatnot shows, and other selling events.

### 4. Activity

Sourcing trips, time tracking, saved thrift locations, purchases, and productivity.

### 5. Insights

Financial reports, analytics, sourcing performance, marketplace comparisons, brand/category profitability, and historical trends.

Put Settings, marketplace connections, data imports, account preferences, and technical configuration in a secondary settings menu.

Do not create ten or fifteen top-level navigation destinations.

Important sections can have internal tabs or contextual navigation.

## Quick actions

Provide a persistent, unobtrusive quick-action system for:

- Add item
- Start timer
- Record sale
- Record purchase
- Create sourcing trip
- Create or open Whatnot show

Prioritize the most relevant actions based on context.

## One-click workflows

Whenever possible, common operations should require no more than a few interactions.

Examples:

- Starting a Buying timer should take one or two taps.
- Recording a purchase should be quick.
- Opening a Whatnot show's performance summary should be easy.
- Editing an item's purchase cost should not require opening an enormous form.
- Recording a sale should automatically calculate profit.
- Viewing last month's earnings should require only changing the date filter.

## Dashboard personalization

Allow optional customization of visible dashboard widgets and their order.

Provide a clean, thoughtfully designed default layout so personalization is never required.

Advanced settings and rarely used functionality should stay out of the way.

---

# 3. Technology Stack

Use:

**Frontend**
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide icons
- Recharts

**Backend**
- Supabase
- PostgreSQL
- Supabase Authentication
- Supabase Storage
- Next.js server routes/actions

**Deployment**
- Vercel-compatible hosting
- Installable PWA
- GitHub repository

Use stable, maintained dependencies and a modular architecture.

Aim to keep normal single-user operation within free hosting/database tiers.

Use environment variables for credentials and never expose marketplace tokens or privileged database credentials to the browser.

Implement database migrations and appropriate Row Level Security policies.

Avoid unnecessary external services, subscriptions, and infrastructure.

Do not build subscription billing, organizations, teams, or commercial SaaS administration.

---

# 4. Visual Design

Create a clean, modern application that feels polished and premium without being visually excessive.

## Style

- Professional analytics dashboard aesthetic.
- Generous spacing.
- Clear typography.
- Rounded cards.
- Subtle shadows and borders.
- Minimal visual clutter.
- Light and dark modes.
- Restrained accent colors.
- Green for positive financial performance.
- Red for negative performance and errors.
- Responsive graphs.
- Readable tables.
- High-quality inventory photo presentation.
- Consistent buttons, modals, and forms.

## Desktop

Use a compact sidebar with the five primary destinations.

Provide a top area for global search, date filters when relevant, notifications, and quick actions.

## Mobile

Optimize particularly for iPhone usage.

Use a compact bottom-navigation or similarly intuitive mobile layout.

Make essential actions thumb-friendly.

The mobile application should support:

- Quick inventory entry.
- Taking/uploading photos.
- Recording purchase costs.
- Starting and ending timers.
- Recording sales.
- Viewing active Whatnot shows.
- Viewing recent earnings.
- Checking inventory while sourcing.

Make the website installable as a PWA.

---

# 5. Home Dashboard

The homepage should answer:

**How is my reselling business doing right now?**

## Main financial metrics

Display:

- Revenue.
- Net operating profit.
- Profit margin.
- Items sold.
- Current inventory at cost.
- Current inventory asking-price total.
- Hours worked.
- Effective hourly earnings.

Use a compact, responsive layout.

Do not overwhelm the initial view with every possible statistic.

Allow secondary metrics to appear through an expandable area or detailed Insights pages.

## Time filters

Support:

- Today
- Yesterday
- Last 7 days
- Last 30 days
- This month
- Last month
- This year
- All time
- Custom range

Relevant metrics and graphs should update together.

## Graphs

Include:

- Revenue over time.
- Profit over time.
- Sales by marketplace.
- Time spent by category.

Allow users to switch between appropriate metrics instead of displaying excessive charts simultaneously.

## Additional dashboard content

Include concise sections for:

- Recent sales.
- Recent activity.
- Inventory awaiting listing.
- Upcoming Whatnot show.
- Most recent Whatnot show performance.
- Marketplace sync status.
- Important alerts.
- Progress toward goals.

Show relevant content contextually.

If no Whatnot show is scheduled, do not display an enormous empty show widget.

---

# 6. Inventory Management

Inventory is the central data structure.

A physical clothing item must exist only once in inventory, even when listed on several marketplaces.

## Inventory attributes

Each item should support:

- Unique item ID.
- Human-readable SKU.
- Title.
- Brand.
- Category/subcategory.
- Size.
- Color.
- Condition.
- Description.
- Multiple photographs.
- Purchase cost.
- Purchase date.
- Purchase source.
- Associated sourcing trip.
- Storage location.
- Notes.
- Listing status.
- Purchase and sale history.
- Marketplace listings and asking prices.
- Created/updated timestamps.

## Inventory statuses

- Purchased
- Unprocessed
- Ready to List
- Listed
- Reserved for Event/Show
- Sold
- Returned
- Archived

Avoid forcing the user to manually manage statuses that can be derived reliably from existing records.

## Inventory interface

Offer:

- Table view.
- Photo grid view.
- Search.
- Sorting.
- Filters.
- Bulk editing.
- Photo uploads.
- CSV imports.
- Quick cost-basis editing.
- Item duplication.
- Inventory aging indicators.

## Item detail view

Show the product photograph, attributes, cost basis, marketplace listings, sales history, and related sourcing information.

Provide contextual actions for editing, listing, marking sold, and assigning to a Whatnot show.

Keep common fields visible and less-used fields expandable.

## Inventory valuation

Track:

1. Original purchase cost of unsold inventory.
2. Total current asking prices for unsold inventory, counting each physical item once.
3. Estimated potential net proceeds at selected sale prices, clearly labeled as estimates.
4. Realized proceeds and profit from completed sales.

Never count multiple marketplace listings as multiple owned items.

---

# 7. Marketplace Listing Management

Support four primary marketplaces:

- Depop
- Vinted
- eBay
- Whatnot

Each physical item may have multiple marketplace listing records.

## Listing data

Store:

- Marketplace.
- External listing ID.
- External listing URL.
- Asking price.
- Original asking price.
- Sale format.
- Date listed.
- Status.
- Last sync date.
- Related physical inventory item.

For Whatnot, support both fixed-price listings and applicable auction/show inventory workflows.

## Central listing interface

Provide:

- All listings in one place.
- Search and filtering by marketplace.
- Listing price comparisons.
- Cross-listing identification.
- Days listed.
- Stale listing detection.
- Direct links to marketplace listings.
- Internal listing edits.
- Bulk status updates.

## Cross-listing protection

If the same item is listed on multiple marketplaces and sells on one:

1. Mark the physical inventory item sold.
2. Record one actual item sale.
3. Update the related listing status.
4. Flag other active listings for delisting.
5. Automatically update external listings only when supported and authorized.
6. Create an actionable alert when manual delisting is required.

Provide duplicate detection and inventory reconciliation.

Never silently assume that two similar marketplace listings refer to the same physical item.

---

# 8. Sales and Transaction Management

Build a centralized sales system for all supported sales channels.

## Transaction information

Track:

- Internal transaction ID.
- External marketplace order ID.
- Item ID.
- Marketplace.
- Sale date.
- Sale price.
- Discounts.
- Shipping collected from buyer.
- Marketplace fees.
- Processing fees.
- Seller-paid shipping.
- Packaging expenses.
- Other direct costs.
- Purchase cost.
- Refunds.
- Adjustments.
- Realized profit.
- Order status.
- Shipment status.
- Payout status.

Support multi-item orders and separate order-level versus item-level allocations.

## Profit formula

Use a consistent and documented definition:

Realized item profit =

Actual seller revenue
− Cost of goods sold
− Marketplace fees
− Payment processing fees
− Seller-paid shipping
− Packaging costs
− Other directly attributable costs.

Account correctly for discounts, refunds, shipping reimbursements, and other adjustments.

Avoid double-counting fees and expenses.

Use safe decimal or integer-cent monetary representations.

## Sales functionality

- Automatic sales imports where available.
- Manual sales entry.
- Transaction editing.
- Refund handling.
- Returns.
- Cancellations.
- Order fulfillment tracking.
- Payout tracking.
- Search and filters.
- CSV export.

Provide useful empty, loading, and error states.

---

# 9. Whatnot Integration and Live Show Management

**Whatnot is a major part of this application's functionality.**

The reseller typically hosts approximately one live selling show per week.

Thrift Log should support his entire Whatnot workflow before, during, and after each show.

Make Whatnot a first-class marketplace, not an improvised add-on.

## 9.1 Official Whatnot Seller API

Whatnot introduced a publicly available Seller API for approved live sellers in October 2026.

Official developer documentation:

https://developers.whatnot.com/

API base URL:

https://api.whatnot.com/seller-api/rest/v2

Research and use the current official API documentation during implementation.

The API supports areas including:

- Products and listings.
- Inventory.
- Merchandising.
- Orders and order items.
- Shipments.
- Shows.
- Show analytics.
- Reports.

Actual functionality depends on the account's access, granted permissions, and supported endpoints.

Do not invent capabilities or endpoints.

### Authentication

For this single-user project, support secure server-side use of a Whatnot personal access token generated by the account owner.

Use only the minimum necessary permissions.

Store the token securely and never expose it in frontend code, logs, or public repositories.

Support token replacement, expiration handling, and disconnecting the integration.

Do not assume OAuth is required when a personal access token is sufficient.

### API integration goals

Prioritize:

1. Import Whatnot products/listings.
2. Import orders and order line items.
3. Import scheduled and past shows.
4. Associate orders with shows.
5. Retrieve show analytics.
6. Retrieve shipment and fulfillment information.
7. Synchronize inventory where authorized.
8. Retrieve available reports.
9. Support near-real-time updates using officially supported webhooks, if compatible with the configured authentication/application model.

Use read-only access first.

Keep potentially destructive write operations optional and require confirmation.

Follow current API rate limits, pagination rules, and retry guidance.

### Whatnot webhooks

Where supported by the developer connection, investigate verified webhooks for:

- Orders created.
- Orders updated.
- Shows scheduled.
- Shows started.
- Shows ended.
- Shipments and inventory changes.

Verify signatures and make event processing idempotent.

If webhooks are unavailable to the user's integration type, implement appropriate manual or scheduled synchronization instead.

Do not pretend that webhook functionality works without the necessary registration or access.

---

## 9.2 Whatnot Show Planner

Create a dedicated show management interface inside:

**Sales → Shows**

Support:

- Create show record.
- Show name.
- Scheduled date/time.
- Show type.
- Notes.
- Associated Whatnot show ID.
- Show status.
- Planned inventory.
- Planned starting bids.
- Planned fixed prices.
- Preparation checklist.
- Associated time sessions.

Import scheduled shows automatically when available.

### Show inventory preparation

Allow the reseller to:

- Select items from existing inventory.
- Add them to an upcoming show's planned lineup.
- View photos, SKUs, purchase costs, and suggested prices.
- Set planned starting bids or asking prices.
- Flag items that need photographs or preparation.
- Mark items as reserved for the show.
- Print or display an inventory checklist.
- Remove items from the show lineup.

Distinguish between:

- Planned items.
- Items actually presented.
- Items sold.
- Items remaining unsold.

Do not automatically remove unsold items from available inventory.

Avoid creating a complicated show management process when the reseller only wants to select some items and go live.

Support a quick-add workflow.

---

## 9.3 Whatnot Show Sales

When possible, import individual Whatnot orders and associate each sale with:

- Show ID.
- Show date.
- Inventory item.
- Buyer/order identifier when authorized.
- Final sale price.
- Relevant fees.
- Shipping charges.
- Refunds.
- Net proceeds.

Because Whatnot shows can involve many rapid transactions, prioritize automated import and matching.

The user should not need to manually record every auction sale when suitable API or exported data is available.

### Item matching

Match imported Whatnot sales to existing inventory using reliable identifiers wherever possible.

Use:

- Internal SKUs.
- External product IDs.
- Order item IDs.
- Explicit inventory mappings.

For ambiguous items, provide a simple reconciliation interface.

Do not automatically invent cost basis or guess which physical item was sold.

Support bundles, multi-item orders, and multiple items shipped in one package without conflating orders with shipments.

If multiple physical inventory items are sold as a single lot, support grouping those items and allocating sale proceeds and costs consistently.

---

## 9.4 Whatnot Show Reports and CSV Imports

Support importing official Whatnot seller reports.

Whatnot provides downloadable show-level CSV reports containing item details, sale prices, fees, and totals.

Also investigate and support relevant:

- Weekly orders reports.
- Available financial reports.
- Ledger/transaction exports.
- Seller statements.
- API-generated reports.

### Import process

1. Upload a Whatnot report.
2. Identify report type.
3. Preview rows.
4. Match the report to a show or reporting period.
5. Detect existing orders and transactions.
6. Import new records.
7. Reconcile fees and adjustments.
8. Identify unmatched inventory.
9. Display a clear import summary.

The user should be able to import another report without duplicating existing sales.

Be careful when combining overlapping reports.

For example, a show report and a weekly orders report may describe the same transaction.

Use stable identifiers, source tracking, and reconciliation rules to avoid double counting.

Preserve original imported report data or sufficient provenance for auditing.

---

## 9.5 Whatnot Show Analytics

Create an attractive, easy-to-understand performance page for each Whatnot show.

### Core show KPIs

Display:

- Gross sales.
- Net revenue after marketplace charges.
- Cost of goods sold.
- Realized operating profit attributable to the show.
- Items sold.
- Number of orders.
- Average order value.
- Show duration.
- Total labor time.
- Profit per labor hour.

### Additional metrics when available

- Unique viewers.
- Peak concurrent viewers.
- Total views.
- First-time buyers.
- Returning buyers.
- Buyer conversion rate, with a clearly defined denominator.
- Sales per streaming hour.
- Orders per streaming hour.
- Average selling price per item.
- Total platform fees.
- Refunds and cancellations.
- Giveaway costs.
- Tips.
- Marketing/promotional expenses.

Only display metrics supported by available data.

Where the API provides estimated earnings, label them as estimates rather than substituting them for accurately calculated profit.

### Show comparisons

Allow comparison of previous shows by:

- Revenue.
- Profit.
- Hourly earnings.
- Average selling price.
- Number of items sold.
- Audience size.
- Conversion.
- Total time investment.

Use graphs where helpful but avoid creating an overwhelming analytics interface.

For example, display a simple history of profit and profit per hour across the last ten shows.

---

## 9.6 Whatnot and Time Tracking

Integrate Whatnot with the application's three existing time categories:

**Buying, Listing, and Selling.**

For Whatnot specifically, support these optional Selling subcategories:

- Show preparation.
- Show setup.
- Livestream selling.
- Post-show sorting.
- Packaging.
- Shipping.
- Buyer follow-up.

Allow a session to be associated with a specific Whatnot show.

### Show labor calculation

Total attributed labor can include:

- Show preparation.
- Setup.
- Actual livestream duration.
- Packing.
- Post-show work.
- Other associated labor.

Avoid counting overlapping sessions twice.

Do not automatically count the stream duration as additional labor if an actual Selling timer is already tracking that period.

When show timestamps are imported, offer to reconcile or create a missing time session with user confirmation.

### Hourly show earnings

Show two separate metrics where useful:

**Profit per livestream hour**

Show profit ÷ actual show duration.

**Profit per total labor hour**

Show profit ÷ all attributed labor, including setup and fulfillment.

The second metric is particularly important.

A three-hour show that produces $300 profit may appear to earn $100/hour.

But if setup and packaging require three additional hours, the effective profit per hour is $50.

Make that distinction obvious.

---

## 9.7 Giveaways, Tips, and Other Whatnot-Specific Transactions

Support Whatnot's distinct transaction types.

### Giveaways

Track:

- Giveaway item.
- Inventory cost when applicable.
- Seller-paid shipping.
- Other direct giveaway costs.
- Associated show.

Giveaways should reduce profitability appropriately.

Do not count a giveaway as an ordinary paid sale.

### Tips

Track tips separately from merchandise revenue.

Include them in overall show income and appropriate profit reporting when realized, but do not distort average merchandise selling prices.

### Refunds and cancellations

Handle:

- Full refunds.
- Partial refunds.
- Canceled orders.
- Additional shipping adjustments.
- Fee corrections.

### Promotional costs

Support manually entered or imported expenses such as:

- Show promotion.
- Advertising.
- Giveaways.
- Other event-specific costs.

These costs should be attributed to the corresponding show when appropriate.

### Payout reconciliation

Distinguish:

- Gross order sales.
- Estimated earnings.
- Completed order earnings.
- Pending payouts.
- Actual payouts.

Do not assume estimated Whatnot earnings equal final realized profit.

---

## 9.8 Post-Show Summary

After a Whatnot show ends, generate a simple performance summary.

Example:

**Saturday Vintage Clothing Show**

- Gross sales: $780
- Sold items: 36
- Purchase cost of sold items: $230
- Platform/processing fees: $85
- Other attributable expenses: $35
- Show profit: $430
- Total labor time: 6h 30m
- Profit per total labor hour: $66.15

These are illustrative numbers only.

Also show:

- Items requiring shipment.
- Sold items still listed elsewhere.
- Items that didn't sell.
- Unmatched sale records.
- Outstanding refunds or adjustments.

Present the important numbers first.

Offer detailed analytics and transaction reconciliation through expandable sections.

---

# 10. Sourcing and Purchasing

Build sourcing tools within **Activity**.

## Sourcing trip records

Track:

- Trip date.
- Location.
- Total spending.
- Items purchased.
- Associated inventory.
- Duration.
- Notes.
- Receipts.
- Additional expenses.

Support multiple purchases during a trip.

## Sourcing analytics

Calculate:

- Items acquired.
- Average purchase cost.
- Realized sales from sourced items.
- Realized profit.
- Unsold inventory remaining.
- Sell-through rate.
- Average time to sell.
- Sourcing time.
- Total attributable labor.
- Realized profit per hour.

Allow comparison across sourcing locations.

## Quick sourcing workflow

On mobile, the user should be able to:

1. Choose a saved thrift location.
2. Start a Buying timer.
3. Finish shopping.
4. End the timer.
5. Record total spending.
6. Add items immediately or later.

Make it possible to split a bulk purchase cost among items.

Support importing items in batches.

---

# 11. Time Tracking and Productivity

**Treat this as a core Phase 1 feature.**

Provide a timer system for three primary categories:

1. Buying
2. Listing
3. Selling

## Timer controls

- Start.
- Pause.
- Resume.
- End.
- Add notes.
- Link to sourcing trip/show/event.
- Manual time entry.
- Edit completed sessions.
- Delete erroneous sessions.
- View history.

Only one active timer should run by default.

## Persistence

Timers must survive:

- Page navigation.
- Phone locking.
- Closing the browser.
- Reopening the installed PWA.
- Temporary internet disconnection.

Use stored timestamps and persistence rather than relying on a continuously running browser timer.

Support offline-friendly timer recovery where practical.

## Activity subcategories

**Buying**
- Thrifting
- Sourcing travel
- Sorting purchases
- Product research

**Listing**
- Photography
- Measurements
- Listing descriptions
- Pricing research
- Publishing listings

**Selling**
- Whatnot livestream
- Show preparation
- Packing
- Shipping
- Other selling events
- Buyer communication

Keep subcategories optional.

Default to showing only the three primary categories to minimize unnecessary decisions.

## Productivity analytics

Show:

- Total hours worked.
- Hours by category.
- Hours by subcategory.
- Daily/weekly/monthly time.
- Effective hourly earnings.
- Average listing time.
- Average time per item acquired.
- Average fulfillment time.
- Time attributed to sourcing trips.
- Time attributed to Whatnot shows.
- Historical productivity trends.

## Two hourly earnings methods

### Period earnings

Operating profit for the selected period ÷ hours worked during that period.

### Project/batch earnings

Realized profit from a show, event, or sourcing batch ÷ attributable labor hours.

These metrics should be separate and clearly labeled.

Period figures may be affected by inventory purchased and listed in one month but sold in another.

Avoid presenting unsold inventory's potential profit as earned income.

Handle zero-hour periods safely.

---

# 12. Saved Locations and Check-Ins

Allow the user to save frequently visited thrift stores and other sourcing locations.

Track:

- Name.
- Address.
- Optional coordinates.
- Activity type.
- Historical sourcing trips.
- Hours spent.
- Items purchased.
- Total spending.
- Realized profit.

## Manual location check-in

Provide one-tap Start Visit and End Visit controls.

Automatically associate the resulting time session with the saved location.

## Foreground location detection

Where available and permission is granted, offer location suggestions when the user opens the PWA.

For example:

"You're near Goodwill Bins. Start a Buying session?"

Do not require continuous background location access.

## Future geofencing compatibility

Design the data structures to support eventual native iPhone geofencing.

Reliable automatic start/stop while the phone is locked should be treated as future native-app functionality.

Do not present a web-based workaround as reliable background geofencing.

---

# 13. Financial Reporting

Create financial reporting tools within **Insights → Finances**.

Support:

- Profit-and-loss reports.
- Revenue trends.
- Cost of goods sold.
- Gross profit.
- Operating expenses.
- Net operating profit.
- Inventory value at cost.
- Cash flow.
- Marketplace payouts.
- Monthly summaries.
- Annual summaries.
- Tax-year transaction exports.

## Expenses

Support:

- Gas and sourcing travel.
- Packaging.
- Supplies.
- Storage.
- Equipment.
- Subscription fees.
- Whatnot show costs.
- Advertising.
- Event fees.
- Other expenses.

Each expense may optionally link to:

- A sourcing trip.
- A Whatnot show.
- An in-person event.
- An inventory item.

Avoid duplicate expense deductions.

## Accounting requirements

Separate:

- Inventory purchases.
- Unsold inventory.
- Cost of goods sold.
- Revenue.
- Direct selling expenses.
- Operating expenses.
- Payouts.
- Refunds.
- Cash receipts.

Ensure that purchasing inventory does not automatically create an equal cost-of-goods-sold expense.

For Whatnot, keep sale-level earnings, show-level estimates, tips, giveaways, and payout adjustments distinguishable.

Document financial calculations clearly.

---

# 14. Analytics and Insights

This section should help the user make better business decisions.

Keep high-level reporting straightforward, while offering detailed breakdowns on demand.

## Brand analysis

Track:

- Revenue.
- Profit.
- Units sold.
- Average selling price.
- Average profit.
- Days to sell.
- Sell-through rate.
- ROI.

## Category analysis

Provide similar reporting for clothing categories.

## Marketplace analysis

Compare:

- Depop.
- Vinted.
- eBay.
- Whatnot.

Measure:

- Revenue.
- Profit.
- Items sold.
- Fees.
- Average selling price.
- Average profit per item.
- Time to sale.
- Marketplace-specific performance trends.

## Whatnot versus traditional marketplaces

Create a useful comparison of:

**Live-show selling versus ordinary online listings.**

Allow comparison of:

- Average selling price.
- Average profit per item.
- Sell-through rate.
- Total fees.
- Time invested.
- Effective hourly earnings.

For example, help answer:

"Am I better off selling these jackets on Whatnot or listing them individually on eBay?"

Where precise labor attribution is unavailable, identify the limitation rather than inventing an answer.

## Inventory analysis

Track:

- Unsold inventory age.
- Capital tied up in inventory.
- Slow-moving inventory.
- High-performing products.
- Sell-through rate.
- Inventory turnover.

## Sourcing analysis

Compare:

- Profit by location.
- ROI by store.
- Time invested.
- Profit per sourced item.
- Profit per hour of sourcing-related labor.

## Productivity analysis

Track changes in:

- Hourly earnings.
- Buying time.
- Listing time.
- Selling time.
- Items processed per hour.
- Profit per item.

Make it easy to recognize whether efficiency is improving.

---

# 15. Other Selling Events

In addition to Whatnot, support occasional in-person selling events.

Use the same general event and profitability architecture where practical.

Track:

- Event name.
- Date.
- Location.
- Inventory brought.
- Inventory sold.
- Fees.
- Expenses.
- Revenue.
- Profit.
- Labor time.
- Profit per hour.

Provide simple manual sales entry during events.

Keep in-person events distinct from livestream shows when their data requirements differ.

---

# 16. Notifications and Alerts

Create a small internal notification center.

Important alerts include:

- Item sold on one marketplace but still listed on another.
- Whatnot show starting soon.
- Unmatched imported Whatnot sales.
- Whatnot orders awaiting fulfillment.
- Marketplace synchronization errors.
- Inventory missing purchase costs.
- Stale listings.
- Inventory awaiting listing.
- Long-running timers.
- Import errors.
- Outstanding transactions requiring review.

Prioritize actionable alerts.

Do not flood the user with low-value notifications.

Group related issues where practical.

---

# 17. Imports, Exports, and Search

## Imports

Support CSV imports for:

- Inventory.
- Sales.
- Listings.
- Expenses.
- Whatnot show reports.
- Whatnot weekly order reports.
- Relevant Whatnot financial reports.
- Other marketplace exports.

Include:

- Preview.
- Column mapping.
- Validation.
- Duplicate detection.
- Import summary.
- Error handling.
- Source/provenance tracking.

Use stable marketplace identifiers when possible.

## Exports

Allow CSV export of:

- Inventory.
- Sales.
- Expenses.
- Time sessions.
- Sourcing trips.
- Whatnot shows.
- Financial summaries.

## Search

Support fast search across major record types.

Optionally provide a compact command/search interface for power users, without making it necessary for ordinary navigation.

---

# 18. Marketplace Integration Architecture

Build a modular adapter system for all four marketplaces.

Each adapter should explicitly report which capabilities it supports.

Potential capabilities:

- Account connection.
- Listing import.
- Sales import.
- Order import.
- Product matching.
- Fee import.
- Inventory synchronization.
- Listing updates.
- Order status updates.
- Historical data import.

## eBay

Implement supported official eBay APIs using appropriate authentication and permissions.

Prioritize reading listings and orders.

## Whatnot

Prioritize the official Seller API and CSV/report imports.

Make Whatnot one of the first real integrations developed.

## Depop and Vinted

Research currently authorized access methods.

If an official API isn't available for the required functionality, provide manual/CSV workflows.

Do not invent unsupported APIs or depend on bypassing security restrictions.

## Unified integration behavior

All marketplaces should ultimately feed into the same inventory, sales, and accounting data structures.

Support:

- Duplicate prevention.
- Sync timestamps.
- Error reporting.
- Manual reconciliation.
- Clear connection status.
- Safe retry behavior.

If an integration requires unavailable credentials, complete its local architecture and configuration interface without pretending it is connected.

---

# 19. Database Design

Create a relational PostgreSQL database with appropriate indexes, constraints, migrations, and security.

Consider these entities:

- profiles
- inventory_items
- inventory_photos
- categories
- marketplace_accounts
- marketplace_listings
- orders
- order_items
- financial_transactions
- refunds
- payouts
- business_expenses
- sourcing_locations
- sourcing_trips
- sourcing_trip_items
- selling_events
- whatnot_shows
- show_inventory
- show_analytics_snapshots
- time_sessions
- activity_categories
- notifications
- goals
- integration_sync_logs
- imported_files
- import_records
- inventory_activity
- settings

Improve, normalize, or consolidate the model where appropriate.

## Database integrity

Critical requirements:

1. Physical inventory is counted once.
2. An item can have multiple listings.
3. A Whatnot show can include many items.
4. An item can be planned for a show without being sold.
5. A show can contain many orders.
6. An order can contain multiple order items.
7. Multiple orders can be grouped into a shipment.
8. Imported sales cannot be duplicated.
9. Refunds and fee adjustments can modify recognized results.
10. Time sessions can be linked to shows, sourcing trips, or other activities.
11. Shared time cannot be double-counted.
12. Monetary calculations must remain accurate.
13. Financial history should not be lost through destructive deletes.
14. Imported data must retain sufficient provenance for reconciliation.
15. Private data must be protected with authorization and RLS.

Use proper timestamp and timezone handling.

Secure photos, receipts, and credentials.

---

# 20. Authentication and Settings

Use Supabase Authentication.

Support secure sign-in and sign-out.

Settings should include:

- Profile.
- Preferred currency.
- Timezone.
- Theme.
- Marketplace connections.
- Whatnot API token configuration.
- Default activity categories.
- Saved sourcing locations.
- Expense categories.
- Financial goals.
- Import/export controls.
- Notification preferences.
- Data management.

Do not introduce unnecessary onboarding.

If a setup wizard is useful, make it short and skippable.

---

# 21. PWA Requirements

Provide:

- Installable web app.
- Web app manifest.
- App icons.
- Standalone display.
- Responsive design.
- Service worker.
- Appropriate caching.
- Offline-friendly application shell.
- Persistent timer state.
- Recoverable draft forms.
- Graceful network error handling.
- Clear sync status.
- Accessible buttons and forms.

Offline edits should use a safe, documented synchronization strategy.

Prevent duplicate actions when connectivity returns.

Do not cache sensitive information insecurely.

Do not claim that offline marketplace records are current.

---

# 22. Optional AI Features

Design an extensible but optional AI layer.

Potential features:

- AI-generated listing titles.
- Listing descriptions from photos.
- Brand/category identification suggestions.
- Pricing suggestions from available comparable data.
- Weekly business summaries.
- Unusual profitability trend detection.
- Natural-language analytics queries.
- Smart sourcing recommendations.

Examples:

"Which thrift location makes me the most money per hour?"

"How much profit did my last four Whatnot shows generate?"

"Which brands sell faster on eBay versus Whatnot?"

"What percentage of my inventory is over 90 days old?"

Do not require AI for basic calculations or reporting.

Never fabricate financial numbers.

Only enable paid API-dependent functionality when properly configured.

Keep core operation inexpensive.

---

# 23. Testing and Reliability

Write meaningful automated tests.

## Financial tests

- Item-level profit.
- Multi-item orders.
- Shipping and fee allocation.
- Refunds.
- Whatnot giveaways.
- Whatnot tips.
- Whatnot fee adjustments.
- Event expenses.
- Inventory cost basis.
- Profit margins.
- Hourly earnings.
- Outstanding payouts.

## Inventory tests

- Cross-listed items.
- Inventory reserved for shows.
- Whatnot show inventory sold.
- Unsold show inventory.
- Returns.
- Duplicate sales prevention.
- Bulk lots and multiple-item orders.

## Integration tests

- Importing Whatnot show reports.
- Importing overlapping Whatnot weekly reports.
- Matching orders to inventory.
- Duplicate detection.
- External API failures.
- Authentication expiration.
- Import corrections.
- Safe reconciliation.

## Timer tests

- Start/pause/resume/end.
- Browser restart.
- Offline recovery.
- Editing sessions.
- Session associations.
- Overlapping timer prevention.
- Hourly earnings calculations.

## Application tests

- Authentication.
- Adding/editing inventory.
- Recording sales.
- Creating sourcing trips.
- Creating shows.
- Importing transactions.
- Running reports.
- Filtering analytics.
- Mobile navigation.

Use suitable unit, integration, and Playwright end-to-end tests.

Run type checking, linting, and build validation.

Do not claim features are complete unless they are implemented and tested.

---

# 24. Demo Data

Provide optional fictional demonstration data.

Include:

- Inventory.
- Depop listings.
- Vinted listings.
- eBay listings.
- Whatnot listings.
- Whatnot shows.
- Show transactions.
- Sourcing trips.
- Time sessions.
- Expenses.
- Financial analytics.

Keep demo data completely separate from real records.

Never represent fictional information as actual marketplace data.

The application must work correctly with an empty database.

---

# 25. Development Sequence

Build systematically while preserving the complete long-term specification.

## Phase 1: Foundation and core usability

- Initialize project.
- Design system.
- Five-section navigation.
- Authentication.
- Database schema.
- Inventory management.
- Manual listings.
- Manual sales.
- Basic financial calculations.
- Manual time tracker.
- PWA installation.

## Phase 2: Operational workflows

- Sourcing trips.
- Saved locations.
- Listing workflow.
- Whatnot show planner.
- Show inventory assignment.
- Other selling events.
- Expenses.
- Fulfillment tracking.
- Time associations.

## Phase 3: Financial and productivity dashboards

- Home dashboard.
- Financial reporting.
- Profit analytics.
- Hourly earnings.
- Brand/category analytics.
- Inventory performance.
- Sourcing analytics.
- Show profitability.

## Phase 4: Marketplace integrations

- Modular marketplace adapter architecture.
- Official Whatnot Seller API.
- Whatnot show/order/report imports.
- Official eBay APIs where supported.
- Depop/Vinted authorized integrations or import fallbacks.
- Data reconciliation.
- Cross-listing alerts.

## Phase 5: Advanced workflows

- Detailed Whatnot analytics.
- Inventory synchronization.
- Bulk operations.
- Alerts.
- Improved imports/exports.
- Optional AI functionality.
- Advanced reports.

## Phase 6: Quality and deployment

- Testing.
- Security.
- PWA reliability.
- Mobile optimization.
- Performance.
- Error handling.
- Deployment preparation.
- Documentation.

These are implementation milestones, not user-facing navigation sections.

Build functional workflows end-to-end rather than producing isolated interfaces that don't connect.

Do not sacrifice core reliability to implement advanced features prematurely.

---

# 26. Project Management and Documentation

Maintain a `PROJECT_STATUS.md` file throughout development.

It should contain:

- Completed features.
- Work in progress.
- Pending features.
- Verified integrations.
- Required credentials.
- Known issues.
- Tests completed.
- Next implementation priorities.

Also maintain:

- README.
- Setup instructions.
- Environment variable documentation.
- Database migration instructions.
- Deployment guide.
- Marketplace integration limitations.
- Calculation definitions.

Keep implementation progress accurate.

Avoid claiming completion based solely on the presence of frontend components.

---

# 27. Definition of Done

The application should allow the user to:

1. Log in securely.
2. Add inventory with photos and purchase costs.
3. Track one physical item across multiple marketplaces.
4. Record and import sales.
5. Calculate actual realized profits.
6. Track business expenses.
7. Organize sourcing trips.
8. Track time spent Buying, Listing, and Selling.
9. Calculate hourly earnings.
10. Save thrift locations.
11. Create and manage Whatnot shows.
12. Associate items with Whatnot shows.
13. Import Whatnot show sales and fees.
14. Reconcile sales with physical inventory.
15. Calculate Whatnot show profitability.
16. Track show preparation, livestream, and fulfillment time.
17. Compare Whatnot performance with other marketplaces.
18. Monitor outstanding orders.
19. Review inventory aging.
20. Analyze profitability by brand/category.
21. Compare sourcing locations.
22. Review financial reports.
23. Import and export data.
24. Install the PWA on an iPhone.
25. Use core features without recurring paid software subscriptions.
26. Navigate all important functionality without an overwhelming or cluttered interface.

For features requiring external credentials, permissions, or API access, clearly distinguish operational implementations from features awaiting configuration.

---

# 28. Final Deliverables

Provide:

- Complete working source code.
- Functional database.
- Database migrations.
- Authentication.
- Inventory management.
- Sales management.
- Sourcing management.
- Whatnot show management.
- Time tracking.
- Financial reporting.
- Analytics.
- Marketplace integration framework.
- PWA configuration.
- Automated tests.
- Environment configuration example.
- Setup instructions.
- Deployment instructions.
- Maintained project status document.

Do not expose secrets in source code or documentation.

If deployment requires credentials that are unavailable, make the application deployment-ready and document the required user actions.

---

# 29. Final Development Instructions

Keep the entire long-term product vision in mind, but prioritize reliable, usable functionality.

**The application's interface should be dramatically simpler than its underlying functionality.**

Do not create a separate page for every feature.

Organize related functionality intelligently.

Use contextual actions, expandable details, and carefully chosen navigation.

The reseller should be able to complete his everyday tasks without studying the software.

The most important functionality is:

- Accurate inventory.
- Automatic sales tracking where supported.
- Accurate financial reporting.
- Simple time tracking.
- Effective hourly earnings.
- Whatnot show management and profitability.
- Useful performance analytics.

Avoid excessive abstractions, fake production data, unnecessary third-party dependencies, and complicated interfaces.

Build the application iteratively, continuously test functionality, and maintain an accurate record of implementation progress.

Make reasonable implementation decisions independently.

Ask for credentials or clarification only when genuinely necessary.

**Begin building Thrift Log now.**
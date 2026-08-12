# Flexepos Payload Builder

Next.js + MUI app for building computation payloads from a server-side Flexepos
scrape. The app logs in, runs each configured store report, parses the HTML
immediately, combines the rows, and shows the raw scraped HTML for inspection
without saving it.

## Getting Started

Install dependencies and copy the env template:

```bash
cp .env.example .env.local
npm install
```

For local scraping without a remote browser, install full Playwright instead:

```bash
npm install playwright
npx playwright install chromium
```

Fill `.env.local` with `FMS_USERNAME` and `FMS_PASSWORD`. The start and end
date are selected in the UI for each scrape run.

Stable scraper settings live in
`src/config/flexepos.config.json`: store numbers, report links, timeouts, and
selectors. For a short test run, set `STORE_NUMBERS=2006,2017` in `.env.local`
to override the committed store list.

Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Select Payroll or Tip
Breakdown Report, choose the start and end date, then start the scrape. Stores
come from `src/config/flexepos.config.json`, unless `STORE_NUMBERS` is set.

The UI runs the configured store list as a client-driven queue. It starts two
one-store scrape requests at a time, waits for both to finish, merges their
payload rows, updates the progress bar, and continues with the next two stores
until every store is done or marked as failed.

For Payroll runs, each successful store-summary scrape is followed by an
employee timeclock detail session. Employee results are streamed back as they
finish and checkpointed in IndexedDB, keyed by run, store, pay period, and
employee ID (falling back to employee number). A store is complete only when
every employee discovered in its Payroll summary has a completed Adjust Time
result. Retrying a failed store skips completed employee checkpoints and
requests only failed or missing employees. A valid Adjust Time table with no
rows counts as completed; a missing table or mismatched pay period does not.
Payroll V2 also displays a live elapsed timer for the complete scrape and a
duration for each completed store timeclock session. Each employee checkpoint
records its own `duration_ms` for detailed benchmarking in IndexedDB.

Supported report payloads:

```json
{
  "employee_id": null,
  "employee_number": null,
  "store_number": null,
  "regular_hours": null,
  "overtime_hours": null
}
```

```json
{
  "store_number": "",
  "total_payins": 0,
  "total_tips": 0
}
```

## Runtime Env Setup

1. Run `npm install` locally so `package-lock.json` includes the
   `playwright-core` runtime dependency before pushing.
2. Set production environment variables from `.env.example`.
3. Use a remote browser provider for Vercel/serverless production and set
   `FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT`.
4. Keep `FLEXEPOS_PLAYWRIGHT_CONNECT_MODE=cdp` unless your provider gives a
   Playwright websocket endpoint, then use `playwright`.
5. For an initial smoke test, temporarily override the committed store list with
   `STORE_NUMBERS=2006,2016`.
6. After the short run works, remove `STORE_NUMBERS` so the app uses
   `src/config/flexepos.config.json`.

Each API call scrapes one store. The browser tab owns the queue, so keep the tab
open until the progress reaches 100%. If you need the scrape to continue after
closing the tab, move the queue to a durable worker with persistent run state.

## Financial sales scraping

See [Financial Scraper](docs/FINANCIAL_SCRAPER.md) for the complete architecture,
run lifecycle, concurrency model, exports, and validation notes.

See [Laravel Fallback Integration Plan](docs/LARAVEL_FALLBACK_INTEGRATION_PLAN.md)
for the secured server-to-server endpoints, Laravel queue contract, and rollout.

Laravel can submit short authenticated batches to:

```text
POST /api/internal/flexepos/sales
POST /api/internal/flexepos/royalties
```

Set the same `FLEXEPOS_SCRAPER_API_TOKEN` in Laravel and Vercel, then send it as
an `Authorization: Bearer ...` header. These endpoints return NDJSON and preserve
Laravel's `request_id` and `job_id` in all applicable events.

Open **Financial > Sales**, select a date range and organization, then choose
**Start / Resume Scrape**. Sales work is created date-first as one store/date
job. The browser runs two Browserless sessions concurrently; each session logs
in once and processes three jobs concurrently within a 45-second budget. This
produces six active Sales jobs across the two Browserless connections.

Every completed or failed job is streamed to the browser and checkpointed in
IndexedDB. Reloading the page does not delete checkpoints: select the same
range and use **Start / Resume Scrape** to continue. **Retry Failed** retries
failed jobs, while **Reload All** clears that range and scrapes it again.

The results table omits zero-value categories and follows the sales comparison
template order. Each store/date group ends with a `SUMMARY` row containing its
total debit, total credit, and balance status. CSV and JSON include those rows.

Browserless free-tier defaults can be tuned with
`FLEXEPOS_SALES_JOBS_PER_SESSION`; keep the value conservative enough to remain
below the provider's one-minute session limit.

## Financial royalties scraping

Open **Financial > Royalties** and select the period and organization. Each job
scrapes one store for the complete date range. The same two-session streaming,
checkpoint, retry, resume, reload, search, pagination, and download behavior is
used as Sales. Non-zero rows follow the six-category royalties template order,
and each store is followed by an inline balanced `SUMMARY` row.

## Verify

```bash
npm test
npm run lint
npm run build
```

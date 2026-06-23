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

## Verify

```bash
npm test
npm run lint
npm run build
```

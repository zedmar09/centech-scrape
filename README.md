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

Fill `.env.local` with `FMS_USERNAME`, `FMS_PASSWORD`, and `STORE_NUMBERS`.
The start and end date are selected in the UI for each scrape run. For local
testing, `STORE_NUMBERS=2006,2017` is enough. The default `.env.example`
contains the 87 stores found in the Centech `env.txt` review.

Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Select Payroll or Tip
Breakdown Report, choose the start and end date, then start the scrape. Stores
come from `STORE_NUMBERS`.

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

## Vercel Staging Setup

1. Run `npm install` locally so `package-lock.json` includes the
   `playwright-core` runtime dependency before pushing.
2. Set Vercel environment variables from `.env.example`.
3. Set `PAYROLL_SCRAPER_SOURCE=flexepos`.
4. Use a remote browser provider for staging/production and set
   `FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT`.
5. Keep `FLEXEPOS_PLAYWRIGHT_CONNECT_MODE=cdp` unless your provider gives a
   Playwright websocket endpoint, then use `playwright`.
6. Deploy to Vercel and test with two stores first, for example
   `STORE_NUMBERS=2006,2016`.
7. After the short run works, restore the full 87-store list.

Each API call scrapes one store. The browser tab owns the queue, so keep the tab
open until the progress reaches 100%. If you need the scrape to continue after
closing the tab, move the queue to a durable worker with persistent run state.

## Save Payload

The `Save Payload` button posts the combined payload to `/api/payroll-payloads`.
Set these env vars when the backend endpoint is ready:

```bash
PAYROLL_PAYLOAD_SAVE_URL=
PAYROLL_PAYLOAD_SAVE_TOKEN=
```

## Verify

```bash
npm test
npm run lint
npm run build
```

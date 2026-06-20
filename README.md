# Payroll Payload Builder

Next.js + MUI app for building payroll computation payloads from a server-side
Flexepos scrape. The app logs in, runs each configured store payroll report,
parses the HTML immediately, combines the rows, and shows the raw scraped HTML
for inspection without saving it.

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

Open [http://localhost:3000](http://localhost:3000). Select the start and end
date, then start the scrape. Stores come from `STORE_NUMBERS`.

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

The current route is synchronous and sets `maxDuration` to 300 seconds. If the
full 87-store scrape exceeds that in staging, move the scrape to chunked jobs or
a durable worker and keep this UI as the launcher/review screen.

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

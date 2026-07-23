# Financial Scraper

## Overview

The Financial workspace retrieves Sales and Royalties reports from Flexepos when
the normal POS data files are unavailable. It is intended to be a fallback data
source, not a replacement for the primary POS feed.

The application consists of:

- a Next.js Financial interface at `/financial`;
- server routes that connect to Browserless with Playwright;
- Flexepos page parsers for Sales and Royalties;
- browser-side run history and checkpoints in IndexedDB; and
- CSV and database-oriented JSON exports.

Sales and Royalties are tabs within the Financial page. Payroll remains
available separately at `/payroll`. Opening `/` redirects to `/financial`.

## Sales job model

A Sales job represents one organization, business date, and store:

```text
Century + 2026-07-01 + store 2006
```

Jobs are processed date-first so all configured stores for one date are queued
before the next date. Store `4083` remains available to Payroll but is excluded
from Financial Sales and Royalties.

The current Century Financial configuration resolves to 86 stores. This matches
`centech-scripts/financial/sales_export_comparison/rules/century.yaml`.

## Browserless and Flexepos concurrency

The Browserless free tier permits two concurrent browser connections. The Sales
worker uses both connections:

```text
2 Browserless connections
× 3 isolated Playwright contexts per connection
= 6 concurrent Flexepos sessions
```

Each Playwright context has independent cookies, storage, pages, and Flexepos
authentication. This satisfies the Flexepos requirement that simultaneous
reports use separate authenticated sessions.

Each Browserless connection receives up to six store/date jobs. Its three
contexts process those jobs from a shared queue while remaining within a
45-second worker budget and the Browserless one-minute session limit.

The relevant optional settings are:

```env
FLEXEPOS_SALES_JOBS_PER_SESSION=6
FLEXEPOS_CONTEXTS_PER_BROWSER=3
```

Live tests on July 1 data produced the following results:

| Contexts in one Browserless connection | Stores completed | Duration | Result |
|---:|---:|---:|---|
| 2 | 2 | 22.9 seconds | Successful |
| 3 | 3 | 22.6 seconds | Successful |
| 4 | 4 | 23.5 seconds | Successful in one run |
| 4 with a full follow-up cycle | 6 of 8 on the first attempt | 40.8 seconds | Two first-attempt failures |

Three contexts are therefore the production default. Four remains accepted as
an explicit experimental setting, but testing showed intermittent Flexepos
login/context failures that removed the expected speed benefit.

With 86 stores over 30 days, Sales creates 2,580 jobs. At the measured
six-store throughput, an ideal run is approximately 2 hours 42 minutes. A
realistic run with session startup and retries is approximately 3–3.5 hours.

Royalties currently uses two Browserless connections with one isolated
Flexepos context per connection. Multi-context Royalties must be validated
separately before its concurrency is increased.

## Runs, checkpoints, and recovery

Every fresh Start Scrape action creates a unique run ID. Checkpoints include the
run ID, so a completed result from an older run is never silently reused by a
new run with the same organization and dates.

Run metadata and checkpoints are stored in the browser's IndexedDB database:

```text
centech-financial
├── financial-runs
├── sales-checkpoints
└── royalty-checkpoints
```

Supported run statuses are:

- `running`
- `paused`
- `completed`
- `completed_with_errors`
- `cancelled`

The Previous Runs selector loads an earlier run and its saved results. Delete
Run removes the selected run and all associated checkpoints after confirmation.
This history is local to the browser and device. When the Laravel backend owns
scrape jobs, run metadata and results should move to its database.

### Retry behavior

Each job receives:

```text
1 initial attempt + 1 automatic retry = 2 automatic attempts
```

After both attempts fail, the checkpoint remains Failed. Retry Failed starts
only the failed jobs from the selected run. Reload All creates a new unique run
instead of overwriting the earlier run.

Pause allows active Browserless sessions to finish and stops the workers from
claiming another batch. Starting again while paused resumes only that same run.
Cancel aborts active requests and marks the run cancelled.

## Scrape Activity and results

Scrape Activity records the date or range, store, attempt, status, and error
message. Running and failed jobs are sorted before queued and completed jobs.
The table supports status filtering and shows 50 jobs per page.

The Results table contains:

- Date
- Store
- Transaction Category
- Debit
- Credit
- Balance Status

Only non-zero transaction categories appear. Each store/date has a display-only
SUMMARY row containing total debit, total credit, and whether the result is
balanced. Search, pagination, CSV download, and JSON download are available.

## Export formats

### CSV

CSV is intended for human review and spreadsheet use. It includes the visible
SUMMARY rows:

```csv
Date,Store,Transaction Category,Debit,Credit,Balance Status
"2026-07-01","2006","Subject to Tax","","197.53",""
"2026-07-01","2006","SUMMARY","4128.08","4128.08","Balanced"
```

### JSON

JSON is a flat, Laravel/database-oriented fallback format. SUMMARY rows are
excluded, and every category is one database-ready object:

```json
{
  "schema_version": 1,
  "run": {
    "run_id": "sales_...",
    "report_type": "sales",
    "organization": "century",
    "start_date": "2026-07-01",
    "end_date": "2026-07-20",
    "generated_at": "2026-07-23T10:30:00Z",
    "source": "flexepos_scrape"
  },
  "rows": [
    {
      "business_date": "2026-07-01",
      "store_number": "2006",
      "category_code": "subject_to_tax",
      "category_name": "Subject to Tax",
      "debit": null,
      "credit": "197.53"
    }
  ]
}
```

Amounts are decimal strings to avoid floating-point loss. Laravel should insert
them into `DECIMAL` columns with chunked `upsert()` operations. The recommended
unique database key is:

```text
organization + report_type + business_date + store_number + category_code
```

## Sales parser behavior

The Sales parser follows the category order defined by the Century comparison
template. It validates that the returned Flexepos store and date match the
requested job before accepting the result.

Register Audit handling requires special care because Flexepos can return
multiple audit-related rows:

- the first valid Register Audit row is authoritative;
- later Register Audit rows do not overwrite it;
- scanning continues so all payouts and pay-ins are collected;
- the integer portion of Over/Short becomes Register Audit Adjustment; and
- the fractional portion becomes Cash Over/Short Adjustment.

Bank Breakdown tables may contain rows shaped like:

```text
Bank Deposit | 21:34 | Bank Deposit | 296.00 | Employee | Comment
```

The parser skips non-monetary values such as `21:34` and selects the actual
monetary cell. Bank Deposit itself is not exported as a transaction category.
Only Register Audit(CID) is used from that table.

## Validation

Live multi-context results for stores 2006, 2016, and 2017 on July 1 matched the
existing `centech-scripts` row counts, debit totals, and credit totals exactly.

A June 29–July 22 site CSV was also compared with the four matching July 23
`centech-scripts` batches:

| Metric | Result before the final Register Audit fix |
|---|---:|
| Store/date jobs | 2,064 |
| Site detail rows | 27,405 |
| Reference rows | 27,419 |
| Exact matching rows | 27,399 |
| Missing site rows | 16 |
| Extra site rows | 2 |
| Different monetary values | 4 |

All stores and dates were present. The differences were isolated to Register
Audit, Cash Over/Short Adjustment, and Register Audit Adjustment. The cause was
that a later Register Audit row could overwrite the first valid row. The parser
now matches the `centech-scripts` first-valid-row behavior, and regression tests
cover both multiple Register Audit rows and Bank Breakdown time values.

The CSV generated before this fix remains unchanged and must not be treated as a
post-fix validation artifact.

## Local development

Required environment variables:

```env
FMS_USERNAME=
FMS_PASSWORD=
FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT=
FLEXEPOS_PLAYWRIGHT_CONNECT_MODE=cdp
```

When local development points to the Browserless WebSocket endpoint, it uses the
same two Browserless connections and three Flexepos contexts per connection as
the deployed application.

Run verification with:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Never commit `.env`, Flexepos credentials, or the Browserless token.

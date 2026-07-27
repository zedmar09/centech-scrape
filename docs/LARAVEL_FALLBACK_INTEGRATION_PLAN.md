# Laravel Flexepos Fallback API

## Purpose

Laravel can use these endpoints to retrieve Flexepos financial data when the
normal POS data file is missing.

The official POS file remains the primary source. Data returned by these
endpoints should be stored as fallback data and replaced or superseded when the
official POS file arrives.

The scraper provides two server-to-server endpoints:

```text
POST /api/internal/flexepos/sales
POST /api/internal/flexepos/royalties
```

They connect to Browserless, log in to Flexepos, scrape the requested jobs, and
stream the results back to Laravel as newline-delimited JSON (NDJSON).

For manual testing, import
[`CENTECH_SCRAPER_API.postman_collection.json`](./CENTECH_SCRAPER_API.postman_collection.json)
into Postman, then set its `base_url` and `api_token` collection variables.

## Authentication

Configure the same secret in the Vercel and Laravel environments:

```env
FLEXEPOS_SCRAPER_API_TOKEN=<long-random-secret>
```

Laravel must include it in every request:

```http
Authorization: Bearer <long-random-secret>
Content-Type: application/json
Accept: application/x-ndjson
```

The endpoint returns:

- `401` when the token is missing or incorrect;
- `503` when the token is not configured on the scraper deployment;
- `415` when the request is not JSON;
- `413` when the request body exceeds 64 KB; and
- `422` when a job fails validation.

## Sales endpoint

```http
POST /api/internal/flexepos/sales
```

A Sales job represents one store and one business date. Send between one and
six unique jobs per request.

```json
{
  "request_id": "sales-batch-20260701-001",
  "jobs": [
    {
      "job_id": "sales-20260701-2006",
      "organization": "century",
      "business_date": "2026-07-01",
      "store_number": "2006",
      "attempt": 1
    }
  ]
}
```

## Royalties endpoint

```http
POST /api/internal/flexepos/royalties
```

A Royalties job represents one store and one date range. Send between one and
six unique jobs per request.

```json
{
  "request_id": "royalties-20260701-20260720-001",
  "jobs": [
    {
      "job_id": "royalties-20260701-20260720-2006",
      "organization": "century",
      "start_date": "2026-07-01",
      "end_date": "2026-07-20",
      "store_number": "2006",
      "attempt": 1
    }
  ]
}
```

Supported organizations are:

```text
century
century_austin
```

The store must belong to the selected organization's committed Financial store
configuration. Century store `4083` is excluded.

## Reading the response

The response is NDJSON. Each line is a complete JSON event, but one HTTP chunk
is not guaranteed to contain exactly one line. Laravel should consume the
response as a stream and split complete events on newline boundaries.

Example:

```json
{"type":"job_started","request_id":"sales-batch-20260701-001","job_id":"sales-20260701-2006","organization":"century","store_number":"2006","business_date":"2026-07-01","attempt":1}
{"type":"job_completed","request_id":"sales-batch-20260701-001","job_id":"sales-20260701-2006","organization":"century","store_number":"2006","business_date":"2026-07-01","attempt":1,"rows":[{"business_date":"2026-07-01","store_number":"2006","category_code":"subject_to_tax","category_name":"Subject to Tax","debit":null,"credit":"197.53"}]}
{"type":"session_completed","request_id":"sales-batch-20260701-001","elapsed_ms":22639}
```

Important event types are:

- `job_started`: Flexepos processing started for the job.
- `job_completed`: The job succeeded and contains flat financial `rows`.
- `job_failed`: The job failed and contains an `error`.
- `session_failed`: The Browserless session failed.
- `session_completed`: The request finished.

Amounts are returned as two-decimal strings or `null` so Laravel can insert
them into decimal database columns without using floating-point arithmetic.

## Laravel usage

Laravel should:

1. Create a unique `request_id` for the batch and `job_id` for every job.
2. Send no more than six jobs in one request.
3. Keep no more than two scraper requests active at once.
4. Read and process the NDJSON response incrementally.
5. Save each `job_completed` result in a database transaction.
6. Mark `job_failed` jobs for retry.
7. Requeue any requested job that never receives `job_completed` or
   `job_failed`.
8. Allow one automatic retry before leaving a job failed for manual review.

The request can time out before every queued job starts. Laravel must therefore
track terminal events by `job_id`; receiving `session_completed` does not by
itself mean every requested job completed.

Example request with Laravel's HTTP client:

```php
$response = Http::withToken(config('services.flexepos_scraper.token'))
    ->accept('application/x-ndjson')
    ->withHeaders(['Content-Type' => 'application/json'])
    ->timeout(65)
    ->post(
        config('services.flexepos_scraper.url').'/api/internal/flexepos/sales',
        [
            'request_id' => $requestId,
            'jobs' => $jobs,
        ],
    );
```

For production batches, use a streaming HTTP client integration rather than
waiting for the complete response body. Do not expose the scraper token to the
browser or Next.js client components.

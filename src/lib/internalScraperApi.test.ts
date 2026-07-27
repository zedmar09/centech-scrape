import { describe, expect, it } from "vitest";

import {
  authorizeInternalScraperRequest,
  parseInternalRoyaltyRequest,
  parseInternalSalesRequest,
  readLimitedJsonRequest,
  transformRoyaltyEvent,
  transformSalesEvent,
} from "./internalScraperApi";

const salesRequest = {
  request_id: "request-1",
  jobs: [{
    attempt: 1,
    business_date: "2026-07-01",
    job_id: "job-1",
    organization: "century" as const,
    store_number: "2006",
  }],
};

describe("internal scraper API", () => {
  it("requires the configured bearer token", async () => {
    const missing = authorizeInternalScraperRequest(
      new Request("https://example.test"),
      "secret",
    );
    expect(missing?.status).toBe(401);

    const valid = authorizeInternalScraperRequest(
      new Request("https://example.test", {
        headers: { authorization: "Bearer secret" },
      }),
      "secret",
    );
    expect(valid).toBeNull();

    const unavailable = authorizeInternalScraperRequest(
      new Request("https://example.test"),
      "",
    );
    expect(unavailable?.status).toBe(503);
  });

  it("limits and parses JSON request bodies", async () => {
    const valid = await readLimitedJsonRequest(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(salesRequest),
      headers: { "content-type": "application/json" },
    }));
    expect(valid.ok).toBe(true);

    const invalid = await readLimitedJsonRequest(new Request("https://example.test", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    }));
    expect(invalid).toEqual({ ok: false, error: "Request body must be valid JSON.", status: 400 });

    const oversized = await readLimitedJsonRequest(new Request("https://example.test", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "70000", "content-type": "application/json" },
    }));
    expect(oversized.ok).toBe(false);

    const wrongType = await readLimitedJsonRequest(new Request("https://example.test", {
      method: "POST",
      body: "{}",
    }));
    expect(wrongType).toMatchObject({ ok: false, status: 415 });
  });

  it("strictly validates Sales jobs", () => {
    expect(parseInternalSalesRequest(salesRequest)).toEqual({
      ok: true,
      value: salesRequest,
    });

    const invalidDate = structuredClone(salesRequest);
    invalidDate.jobs[0].business_date = "2026-02-30";
    expect(parseInternalSalesRequest(invalidDate)).toMatchObject({ ok: false });

    const excludedStore = structuredClone(salesRequest);
    excludedStore.jobs[0].store_number = "4083";
    expect(parseInternalSalesRequest(excludedStore)).toMatchObject({ ok: false });

    const duplicateId = {
      ...salesRequest,
      jobs: [
        salesRequest.jobs[0],
        { ...salesRequest.jobs[0], business_date: "2026-07-02" },
      ],
    };
    expect(parseInternalSalesRequest(duplicateId)).toEqual({
      ok: false,
      error: "jobs.1.job_id must be unique.",
    });

    expect(parseInternalSalesRequest({
      ...salesRequest,
      jobs: Array.from({ length: 7 }, (_, index) => ({
        ...salesRequest.jobs[0],
        business_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        job_id: `job-${index}`,
      })),
    })).toEqual({
      ok: false,
      error: "jobs must not contain more than 6 jobs.",
    });
  });

  it("validates Royalty ranges", () => {
    const result = parseInternalRoyaltyRequest({
      request_id: "request-2",
      jobs: [{
        attempt: 1,
        end_date: "2026-07-01",
        job_id: "job-2",
        organization: "century",
        start_date: "2026-07-20",
        store_number: "2006",
      }],
    });
    expect(result).toEqual({
      ok: false,
      error: "jobs.0.end_date must not be before start_date.",
    });
  });

  it("returns flat database-oriented Sales events", () => {
    const event = transformSalesEvent({
      type: "job_completed",
      key: "century|2026-07-01|2006",
      rows: [{
        credit: 197.53,
        date: "2026-07-01",
        debit: null,
        store: "2006",
        transaction_category: "Subject to Tax",
      }],
    }, salesRequest);

    expect(event).toMatchObject({
      type: "job_completed",
      request_id: "request-1",
      job_id: "job-1",
      rows: [{
        business_date: "2026-07-01",
        store_number: "2006",
        category_code: "subject_to_tax",
        category_name: "Subject to Tax",
        debit: null,
        credit: "197.53",
      }],
    });
  });

  it("returns flat database-oriented Royalty events", () => {
    const request = {
      request_id: "request-2",
      jobs: [{
        attempt: 1,
        end_date: "2026-07-20",
        job_id: "job-2",
        organization: "century" as const,
        start_date: "2026-07-01",
        store_number: "2006",
      }],
    };
    const event = transformRoyaltyEvent({
      type: "job_completed",
      key: "century|2026-07-01|2026-07-20|2006",
      rows: [{
        credit: null,
        debit: 500,
        transaction_category: "Royalty Fee",
      }],
    }, request);

    expect(event).toMatchObject({
      request_id: "request-2",
      job_id: "job-2",
      rows: [{
        start_date: "2026-07-01",
        end_date: "2026-07-20",
        store_number: "2006",
        category_code: "royalty_fee",
        debit: "500.00",
        credit: null,
      }],
    });
  });
});

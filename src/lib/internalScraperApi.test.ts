import { describe, expect, it } from "vitest";

import {
  authorizeInternalScraperRequest,
  parseInternalRoyaltyRequest,
  parseInternalSalesRequest,
  readLimitedJsonRequest,
  transformNdjsonResponse,
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

  it("stops reading a chunked request as soon as it exceeds the body limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("1234567890"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await readLimitedJsonRequest(new Request("https://example.test", {
      method: "POST",
      body,
      duplex: "half",
      headers: { "content-type": "application/json" },
    } as RequestInit & { duplex: "half" }), 12);

    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(cancelled).toBe(true);
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
      jobs: Array.from({ length: 4 }, (_, index) => ({
        ...salesRequest.jobs[0],
        business_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        job_id: `job-${index}`,
      })),
    })).toEqual({
      ok: false,
      error: "jobs must not contain more than 3 jobs.",
    });

    const duplicateStoreDate = {
      ...salesRequest,
      jobs: [
        salesRequest.jobs[0],
        { ...salesRequest.jobs[0], job_id: "job-2" },
      ],
    };
    expect(parseInternalSalesRequest(duplicateStoreDate)).toEqual({
      ok: false,
      error: "jobs.1 duplicates another store/date job.",
    });

    expect(parseInternalSalesRequest({
      ...salesRequest,
      jobs: [{ ...salesRequest.jobs[0], business_date: "2028-02-29" }],
    })).toMatchObject({ ok: true });
    expect(parseInternalSalesRequest({
      ...salesRequest,
      jobs: [{ ...salesRequest.jobs[0], business_date: "2027-02-29" }],
    })).toMatchObject({ ok: false });
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

  it("transforms NDJSON split across chunks and a final line without a newline", async () => {
    const encoder = new TextEncoder();
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"job_sta'));
        controller.enqueue(encoder.encode('rted"}\n{"type":"session_completed"}'));
        controller.close();
      },
    }), {
      headers: { "content-type": "application/x-ndjson" },
    });

    const transformed = transformNdjsonResponse(upstream, (event) => ({
      ...(event as Record<string, unknown>),
      request_id: "request-1",
    }));

    expect(transformed.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(await transformed.text()).toBe(
      '{"type":"job_started","request_id":"request-1"}\n' +
      '{"type":"session_completed","request_id":"request-1"}\n',
    );
  });

  it("passes through non-success upstream responses", () => {
    const upstream = Response.json({ error: "upstream failed" }, { status: 503 });
    expect(transformNdjsonResponse(upstream, (event) => event)).toBe(upstream);
  });
});

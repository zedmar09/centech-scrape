import { createHash, timingSafeEqual } from "node:crypto";

import { categoryCode } from "./financialExport";
import { isConfiguredFinancialStore } from "./financialStores";
import { royaltyJobKey, type RoyaltyJob } from "./royaltyReport";
import { salesJobKey, type SalesJob, type SalesOrganization } from "./salesReport";

export const INTERNAL_SALES_JOB_LIMIT = 6;
export const INTERNAL_ROYALTY_JOB_LIMIT = 6;

export type InternalSalesJob = {
  job_id: string;
  organization: SalesOrganization;
  business_date: string;
  store_number: string;
  attempt: number;
};

export type InternalRoyaltyJob = {
  job_id: string;
  organization: SalesOrganization;
  start_date: string;
  end_date: string;
  store_number: string;
  attempt: number;
};

export type InternalSalesRequest = {
  request_id: string;
  jobs: InternalSalesJob[];
};

export type InternalRoyaltyRequest = {
  request_id: string;
  jobs: InternalRoyaltyJob[];
};

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export async function readLimitedJsonRequest(request: Request, maxBytes = 64 * 1024) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { ok: false as const, error: "Content-Type must be application/json.", status: 415 };
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false as const, error: `Request body must not exceed ${maxBytes} bytes.`, status: 413 };
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    return { ok: false as const, error: `Request body must not exceed ${maxBytes} bytes.`, status: 413 };
  }
  try {
    return { ok: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false as const, error: "Request body must be valid JSON.", status: 400 };
  }
}

export function authorizeInternalScraperRequest(
  request: Request,
  configuredToken = process.env.FLEXEPOS_SCRAPER_API_TOKEN,
) {
  if (!configuredToken) {
    return Response.json(
      { error: "Internal scraper API is not configured." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match || !safeEqual(match[1], configuredToken)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

export function parseInternalSalesRequest(value: unknown): ParseResult<InternalSalesRequest> {
  const common = parseCommonRequest(value, INTERNAL_SALES_JOB_LIMIT);
  if (!common.ok) return common;

  const jobs: InternalSalesJob[] = [];
  const naturalKeys = new Set<string>();
  const jobIds = new Set<string>();
  for (const [index, candidate] of common.value.jobs.entries()) {
    const parsed = parseBaseJob(candidate, index);
    if (!parsed.ok) return parsed;
    if (jobIds.has(parsed.value.job_id)) return failure(`jobs.${index}.job_id must be unique.`);
    jobIds.add(parsed.value.job_id);
    const item = candidate as Record<string, unknown>;
    const businessDate = stringValue(item.business_date);
    if (!isIsoDate(businessDate)) {
      return failure(`jobs.${index}.business_date must be a valid ISO date.`);
    }

    const job = { ...parsed.value, business_date: businessDate };
    const key = salesJobKey(job);
    if (naturalKeys.has(key)) return failure(`jobs.${index} duplicates another store/date job.`);
    naturalKeys.add(key);
    jobs.push(job);
  }

  return { ok: true, value: { request_id: common.value.request_id, jobs } };
}

export function parseInternalRoyaltyRequest(value: unknown): ParseResult<InternalRoyaltyRequest> {
  const common = parseCommonRequest(value, INTERNAL_ROYALTY_JOB_LIMIT);
  if (!common.ok) return common;

  const jobs: InternalRoyaltyJob[] = [];
  const naturalKeys = new Set<string>();
  const jobIds = new Set<string>();
  for (const [index, candidate] of common.value.jobs.entries()) {
    const parsed = parseBaseJob(candidate, index);
    if (!parsed.ok) return parsed;
    if (jobIds.has(parsed.value.job_id)) return failure(`jobs.${index}.job_id must be unique.`);
    jobIds.add(parsed.value.job_id);
    const item = candidate as Record<string, unknown>;
    const startDate = stringValue(item.start_date);
    const endDate = stringValue(item.end_date);
    if (!isIsoDate(startDate)) {
      return failure(`jobs.${index}.start_date must be a valid ISO date.`);
    }
    if (!isIsoDate(endDate)) {
      return failure(`jobs.${index}.end_date must be a valid ISO date.`);
    }
    if (endDate < startDate) {
      return failure(`jobs.${index}.end_date must not be before start_date.`);
    }

    const job = { ...parsed.value, start_date: startDate, end_date: endDate };
    const key = royaltyJobKey({ ...job, attempts: job.attempt });
    if (naturalKeys.has(key)) return failure(`jobs.${index} duplicates another store/range job.`);
    naturalKeys.add(key);
    jobs.push(job);
  }

  return { ok: true, value: { request_id: common.value.request_id, jobs } };
}

export function salesUpstreamJobs(request: InternalSalesRequest): SalesJob[] {
  return request.jobs.map((job) => ({
    attempts: job.attempt,
    business_date: job.business_date,
    organization: job.organization,
    store_number: job.store_number,
  }));
}

export function royaltyUpstreamJobs(request: InternalRoyaltyRequest): RoyaltyJob[] {
  return request.jobs.map((job) => ({
    attempts: job.attempt,
    end_date: job.end_date,
    organization: job.organization,
    start_date: job.start_date,
    store_number: job.store_number,
  }));
}

export function transformSalesEvent(
  event: unknown,
  request: InternalSalesRequest,
) {
  const source = eventRecord(event);
  const metadata = source.key
    ? request.jobs.find((job) => salesJobKey(job) === source.key)
    : undefined;
  const base = eventBase(source, request.request_id, metadata);
  if (source.type !== "job_completed" || !metadata) return base;

  return {
    ...base,
    rows: arrayValue(source.rows).map((row) => {
      const item = eventRecord(row);
      return {
        business_date: metadata.business_date,
        store_number: metadata.store_number,
        category_code: categoryCode(stringValue(item.transaction_category)),
        category_name: stringValue(item.transaction_category),
        debit: decimalValue(item.debit),
        credit: decimalValue(item.credit),
      };
    }),
  };
}

export function transformRoyaltyEvent(
  event: unknown,
  request: InternalRoyaltyRequest,
) {
  const source = eventRecord(event);
  const metadata = source.key
    ? request.jobs.find((job) => royaltyJobKey({ ...job, attempts: job.attempt }) === source.key)
    : undefined;
  const base = eventBase(source, request.request_id, metadata);
  if (source.type !== "job_completed" || !metadata) return base;

  return {
    ...base,
    rows: arrayValue(source.rows).map((row) => {
      const item = eventRecord(row);
      return {
        start_date: metadata.start_date,
        end_date: metadata.end_date,
        store_number: metadata.store_number,
        category_code: categoryCode(stringValue(item.transaction_category)),
        category_name: stringValue(item.transaction_category),
        debit: decimalValue(item.debit),
        credit: decimalValue(item.credit),
      };
    }),
  };
}

export function transformNdjsonResponse(
  response: Response,
  transform: (event: unknown) => unknown,
) {
  if (!response.ok || !response.body) return response;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      reader = response.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(encoder.encode(`${JSON.stringify(transform(JSON.parse(line)))}\n`));
            }
          }
          if (done) break;
        }
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(`${JSON.stringify(transform(JSON.parse(buffer)))}\n`));
        }
      } catch (caught) {
        controller.error(caught);
        return;
      }
      controller.close();
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function parseCommonRequest(value: unknown, limit: number): ParseResult<{
  request_id: string;
  jobs: unknown[];
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure("Request body must be a JSON object.");
  }
  const item = value as Record<string, unknown>;
  const requestId = stringValue(item.request_id);
  if (!validIdentifier(requestId)) {
    return failure("request_id must be 1-100 URL-safe characters.");
  }
  if (!Array.isArray(item.jobs) || item.jobs.length === 0) {
    return failure("jobs must contain at least one job.");
  }
  if (item.jobs.length > limit) {
    return failure(`jobs must not contain more than ${limit} jobs.`);
  }
  return { ok: true, value: { request_id: requestId, jobs: item.jobs } };
}

function parseBaseJob(value: unknown, index: number): ParseResult<{
  job_id: string;
  organization: SalesOrganization;
  store_number: string;
  attempt: number;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure(`jobs.${index} must be an object.`);
  }
  const item = value as Record<string, unknown>;
  const jobId = stringValue(item.job_id);
  if (!validIdentifier(jobId)) {
    return failure(`jobs.${index}.job_id must be 1-100 URL-safe characters.`);
  }
  const organization = item.organization;
  if (organization !== "century" && organization !== "century_austin") {
    return failure(`jobs.${index}.organization is not supported.`);
  }
  const storeNumber = stringValue(item.store_number);
  if (!isConfiguredFinancialStore(organization, storeNumber)) {
    return failure(`jobs.${index}.store_number is not configured for ${organization}.`);
  }
  const attempt = item.attempt;
  if (!Number.isInteger(attempt) || Number(attempt) < 1 || Number(attempt) > 10) {
    return failure(`jobs.${index}.attempt must be an integer from 1 to 10.`);
  }
  return {
    ok: true,
    value: {
      attempt: Number(attempt),
      job_id: jobId,
      organization,
      store_number: storeNumber,
    },
  };
}

function eventBase(
  source: Record<string, unknown>,
  requestId: string,
  metadata?: InternalSalesJob | InternalRoyaltyJob,
) {
  return {
    type: stringValue(source.type),
    request_id: requestId,
    ...(metadata ? {
      job_id: metadata.job_id,
      organization: metadata.organization,
      store_number: metadata.store_number,
      attempt: metadata.attempt,
      ...("business_date" in metadata
        ? { business_date: metadata.business_date }
        : { start_date: metadata.start_date, end_date: metadata.end_date }),
    } : {}),
    ...(typeof source.context_index === "number" ? { context_index: source.context_index } : {}),
    ...(typeof source.elapsed_ms === "number" ? { elapsed_ms: source.elapsed_ms } : {}),
    ...(typeof source.error === "string" ? { error: source.error } : {}),
  };
}

function decimalValue(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Scraper returned an invalid monetary value.");
  return parsed.toFixed(2);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function validIdentifier(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function eventRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function failure<T = never>(error: string): ParseResult<T> {
  return { ok: false, error };
}

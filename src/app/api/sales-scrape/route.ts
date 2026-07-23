import { NextRequest } from "next/server";

import {
  createBrowser,
  createFlexeposPayrollConfig,
  ensureAuthenticated,
  gotoWithRetry,
} from "@/lib/flexeposPayrollScraper";
import { scrapeCsdPage, type SalesPage } from "@/lib/salesPageScraper";
import {
  salesJobKey,
  toSalesComparisonRows,
  type SalesJob,
  type SalesOrganization,
} from "@/lib/salesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_MAX_JOBS = 6;
const MAX_JOBS = 10;
const DEFAULT_CONTEXTS_PER_BROWSER = 3;
const MAX_CONTEXTS_PER_BROWSER = 4;
const SESSION_BUDGET_MS = 45_000;
const CSD_URL = "https://fms.flexepos.com/FlexeposWeb/reports/netsuite.seam?cid=29099";

type SalesScrapeRequest = { jobs?: unknown };

export async function POST(request: NextRequest) {
  let body: SalesScrapeRequest;
  try {
    body = (await request.json()) as SalesScrapeRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const jobs = parseJobs(body.jobs).slice(0, readMaxJobs());
  if (jobs.length === 0) {
    return Response.json({ error: "Provide at least one sales store/date job." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const startedAt = Date.now();
      let browser: Awaited<ReturnType<typeof createBrowser>> | null = null;

      try {
        const firstJob = jobs[0];
        const baseConfig = createFlexeposPayrollConfig(process.env, {
          startDate: firstJob.business_date,
          endDate: firstJob.business_date,
        });
        const config = {
          ...baseConfig,
          navigationRetries: 1,
          navigationTimeoutMs: Math.min(baseConfig.navigationTimeoutMs, 12_000),
          timeoutMs: Math.min(baseConfig.timeoutMs, 12_000),
          waitAfterActionMs: Math.min(baseConfig.waitAfterActionMs, 500),
          waitBeforeActionMs: Math.min(baseConfig.waitBeforeActionMs, 250),
        };
        browser = await createBrowser(config);
        const queue = [...jobs];
        const reportUrl = process.env.FLEXEPOS_CSD_URL?.trim() || CSD_URL;

        async function runIsolatedFlexeposSession(contextIndex: number) {
          const context = await browser!.newContext({
            ignoreHTTPSErrors: false,
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            viewport: { width: 1440, height: 1000 },
          });
          try {
            const page = await context.newPage();
            page.setDefaultTimeout(Math.min(config.timeoutMs, 15_000));
            page.setDefaultNavigationTimeout(Math.min(config.navigationTimeoutMs, 15_000));
            await ensureAuthenticated(page, config);
            await gotoWithRetry(page, reportUrl, config);

            while (queue.length && Date.now() - startedAt < SESSION_BUDGET_MS) {
              const job = queue.shift();
              if (!job) break;
              const key = salesJobKey(job);
              send({ type: "job_started", key, job, context_index: contextIndex });
              try {
                const flexDate = toFlexDate(job.business_date);
                await gotoWithRetry(page, reportUrl, config);
                await page.locator(config.selectors.store).first().fill(job.store_number);
                await page.locator(config.selectors.startDate).first().fill(flexDate);
                await page.locator(config.selectors.submit).first().click();
                await page.waitForLoadState("domcontentloaded").catch(() => undefined);
                const aggregate = await scrapeCsdPage(
                  page as unknown as SalesPage,
                  job.store_number,
                  flexDate,
                  15_000,
                );
                send({
                  type: "job_completed",
                  key,
                  job,
                  aggregate,
                  rows: toSalesComparisonRows(aggregate),
                  context_index: contextIndex,
                });
              } catch (caught) {
                send({
                  type: "job_failed",
                  key,
                  job,
                  error: caught instanceof Error ? caught.message : "Sales scrape failed.",
                  context_index: contextIndex,
                });
              }
            }
          } finally {
            await context.close().catch(() => undefined);
          }
        }

        const contextResults = await Promise.allSettled(
          Array.from(
            { length: Math.min(readContextsPerBrowser(), jobs.length) },
            (_, index) => runIsolatedFlexeposSession(index + 1),
          ),
        );
        for (const [index, result] of contextResults.entries()) {
          if (result.status === "rejected") {
            send({
              type: "context_failed",
              context_index: index + 1,
              error: result.reason instanceof Error ? result.reason.message : "An isolated Flexepos session failed.",
            });
          }
        }
        send({ type: "session_completed", elapsed_ms: Date.now() - startedAt });
      } catch (caught) {
        send({
          type: "session_failed",
          error: caught instanceof Error ? caught.message : "Browserless sales session failed.",
        });
      } finally {
        await browser?.close().catch(() => undefined);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function parseJobs(value: unknown): SalesJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const organization = item.organization;
    const businessDate = typeof item.business_date === "string" ? item.business_date : "";
    const storeNumber = typeof item.store_number === "string" ? item.store_number.trim() : "";
    if (
      (organization !== "century" && organization !== "century_austin") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
      !/^\d+$/.test(storeNumber)
    ) return [];
    return [{
      attempts: Number.isFinite(item.attempts) ? Number(item.attempts) : 0,
      business_date: businessDate,
      organization: organization as SalesOrganization,
      store_number: storeNumber,
    }];
  });
}

function readMaxJobs() {
  const parsed = Number.parseInt(process.env.FLEXEPOS_SALES_JOBS_PER_SESSION ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(MAX_JOBS, Math.max(1, parsed)) : DEFAULT_MAX_JOBS;
}

function readContextsPerBrowser() {
  const parsed = Number.parseInt(process.env.FLEXEPOS_CONTEXTS_PER_BROWSER ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(MAX_CONTEXTS_PER_BROWSER, Math.max(1, parsed))
    : DEFAULT_CONTEXTS_PER_BROWSER;
}

function toFlexDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

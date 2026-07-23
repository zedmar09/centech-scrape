import { NextRequest } from "next/server";

import { createBrowser, createFlexeposPayrollConfig, ensureAuthenticated, gotoWithRetry } from "@/lib/flexeposPayrollScraper";
import { scrapeRoyaltyPage } from "@/lib/royaltyPageScraper";
import { royaltyJobKey, toRoyaltyRows, type RoyaltyJob } from "@/lib/royaltyReport";
import type { SalesPage } from "@/lib/salesPageScraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPORT_URL = "https://fms.flexepos.com/FlexeposWeb/royalty.seam?cid=268311";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { jobs?: unknown } | null;
  const jobs = parseJobs(body?.jobs).slice(0, 6);
  if (!jobs.length) return Response.json({ error: "Provide royalty jobs." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const started = Date.now();
      let browser: Awaited<ReturnType<typeof createBrowser>> | null = null;
      try {
        const first = jobs[0];
        const base = createFlexeposPayrollConfig(process.env, { startDate: first.start_date, endDate: first.end_date });
        const config = { ...base, navigationRetries: 1, navigationTimeoutMs: 12_000, timeoutMs: 12_000, waitAfterActionMs: 500, waitBeforeActionMs: 250 };
        browser = await createBrowser(config);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        page.setDefaultTimeout(12_000);
        page.setDefaultNavigationTimeout(12_000);
        await ensureAuthenticated(page, config);

        for (const job of jobs) {
          if (Date.now() - started >= 45_000) break;
          const key = royaltyJobKey(job);
          send({ type: "job_started", key, job });
          try {
            await gotoWithRetry(page, process.env.FLEXEPOS_ROYALTY_URL?.trim() || REPORT_URL, config);
            await page.locator(config.selectors.store).first().fill(job.store_number);
            await page.locator(config.selectors.startDate).first().fill(flexDate(job.start_date));
            await page.locator(config.selectors.endDate).first().fill(flexDate(job.end_date));
            await page.locator(config.selectors.submit).first().click();
            await page.waitForLoadState("domcontentloaded").catch(() => undefined);
            const aggregate = await scrapeRoyaltyPage(page as unknown as SalesPage, job.store_number, job.start_date, job.end_date);
            send({ type: "job_completed", key, job, aggregate, rows: toRoyaltyRows(aggregate) });
          } catch (caught) {
            send({ type: "job_failed", key, job, error: caught instanceof Error ? caught.message : "Royalty scrape failed." });
          }
        }
        send({ type: "session_completed", elapsed_ms: Date.now() - started });
      } catch (caught) {
        send({ type: "session_failed", error: caught instanceof Error ? caught.message : "Royalty session failed." });
      } finally {
        await browser?.close().catch(() => undefined);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "cache-control": "no-store", "content-type": "application/x-ndjson; charset=utf-8" } });
}

function parseJobs(value: unknown): RoyaltyJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const organization = item.organization;
    const start = typeof item.start_date === "string" ? item.start_date : "";
    const end = typeof item.end_date === "string" ? item.end_date : "";
    const store = typeof item.store_number === "string" ? item.store_number.trim() : "";
    if ((organization !== "century" && organization !== "century_austin") || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d+$/.test(store)) return [];
    return [{ attempts: Number(item.attempts) || 0, organization, start_date: start, end_date: end, store_number: store }];
  });
}

function flexDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

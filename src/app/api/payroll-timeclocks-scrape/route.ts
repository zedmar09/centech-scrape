import { NextRequest } from "next/server";

import {
  createBrowser,
  createFlexeposPayrollConfig,
  ensureAuthenticated,
  findReportUrl,
  gotoWithRetry,
} from "@/lib/flexeposPayrollScraper";
import {
  employeeKey,
  timeclockCheckpointKey,
  validateTimeclockResult,
  type EmployeeTimeclockCheckpoint,
  type PayrollEmployeeRef,
  type TimeclockRow,
} from "@/lib/payrollTimeclocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  run_id?: unknown;
  store_number?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  completed_employee_keys?: unknown;
};

type EmployeeLink = PayrollEmployeeRef & { href: string };

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const encoder = new TextEncoder();
  let browser: Awaited<ReturnType<typeof createBrowser>> | null = null;
  let aborted = request.signal.aborted;
  const closeBrowser = async () => {
    const activeBrowser = browser;
    browser = null;
    await activeBrowser?.close().catch(() => undefined);
  };
  request.signal.addEventListener("abort", () => {
    aborted = true;
    void closeBrowser();
  }, { once: true });
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        if (!aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const sessionStartedAt = Date.now();
      try {
        const config = createFlexeposPayrollConfig(process.env, {
          startDate: parsed.value.startDate,
          endDate: parsed.value.endDate,
          reportType: "payroll",
        });
        browser = await createBrowser(config);
        const context = await browser.newContext({
          ignoreHTTPSErrors: false,
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36",
          viewport: { width: 1440, height: 1000 },
        });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(config.timeoutMs);
          page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
          await ensureAuthenticated(page, config);
          const reportUrl = await findReportUrl(page, config);
          await gotoWithRetry(page, reportUrl, config);
          await page.locator(config.selectors.store).first().fill(parsed.value.storeNumber);
          await page.locator(config.selectors.startDate).first().fill(config.startDate ?? "");
          await page.locator(config.selectors.endDate).first().fill(config.endDate ?? "");
          await page.locator(config.selectors.overtime).first().check();
          await page.locator(config.selectors.submit).first().click();
          await page.waitForLoadState("domcontentloaded").catch(() => undefined);
          await page.locator(config.selectors.payrollTable).first()
            .waitFor({ state: "visible", timeout: config.timeoutMs });

          const links = await extractEmployeeLinks(page, Number(parsed.value.storeNumber));
          send({
            type: "employee_list",
            expected: links.map((employee) => ({
              employee_id: employee.employee_id,
              employee_number: employee.employee_number,
              store_number: employee.store_number,
            })),
          });
          for (const employee of links) {
            if (aborted) break;
            const identity = employeeKey(employee);
            if (!identity || parsed.value.completedKeys.has(identity)) continue;
            const base = {
              ...employee,
              key: timeclockCheckpointKey(
                parsed.value.runId,
                employee,
                config.startDate ?? "",
                config.endDate ?? "",
              ),
              pay_period_start: config.startDate ?? "",
              pay_period_end: config.endDate ?? "",
            };
            const employeeStartedAt = Date.now();
            let rows: TimeclockRow[] | null = null;
            let lastError: unknown;
            let attempts = 0;
            for (let attempt = 1; attempt <= 2 && !rows && !aborted; attempt += 1) {
              attempts = attempt;
              try {
                rows = await scrapeEmployeeTimeclock(page, employee, config);
              } catch (caught) {
                lastError = caught;
                if (attempt < 2) send({ type: "employee_retrying", employee, attempt: attempt + 1 });
              }
            }
            if (aborted) break;
            if (rows) {
              const checkpoint: EmployeeTimeclockCheckpoint = {
                ...base, attempts, duration_ms: Date.now() - employeeStartedAt,
                rows, status: "completed", updated_at: new Date().toISOString(),
              };
              send({ type: "employee_checkpoint", checkpoint });
            } else {
              const checkpoint: EmployeeTimeclockCheckpoint = {
                ...base,
                attempts,
                duration_ms: Date.now() - employeeStartedAt,
                error: lastError instanceof Error ? lastError.message : "Timeclock scrape failed.",
                rows: [],
                status: "failed",
                updated_at: new Date().toISOString(),
              };
              send({ type: "employee_checkpoint", checkpoint });
            }
          }
          if (!aborted) send({ type: "session_completed", elapsed_ms: Date.now() - sessionStartedAt });
        } finally {
          await context.close().catch(() => undefined);
        }
      } catch (caught) {
        if (!aborted) {
          send({
            type: "session_failed",
            elapsed_ms: Date.now() - sessionStartedAt,
            error: caught instanceof Error ? caught.message : "Payroll timeclock session failed.",
          });
        }
      } finally {
        await closeBrowser();
        if (!aborted) controller.close();
      }
    },
    async cancel() {
      aborted = true;
      await closeBrowser();
    },
  });
  return new Response(stream, {
    headers: { "cache-control": "no-store", "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

async function extractEmployeeLinks(page: Parameters<typeof ensureAuthenticated>[0], storeNumber: number) {
  return page.evaluate(({ storeNumber: store }) => {
    const result: Array<{ employee_id: number | null; employee_number: number | null; store_number: number; href: string }> = [];
    for (const row of document.querySelectorAll("table tr")) {
      const cells = [...row.querySelectorAll("td")];
      const link = cells[0]?.querySelector<HTMLAnchorElement>("a[href]");
      if (!link) continue;
      const params = new URL(link.href, document.baseURI).searchParams;
      const employeeIdText = params.get("id") ?? "";
      const employeeNumberText = (cells[1]?.textContent ?? "").replace(/[^0-9-]/g, "");
      const employeeId = employeeIdText ? Number(employeeIdText) : Number.NaN;
      const employeeNumber = employeeNumberText ? Number(employeeNumberText) : Number.NaN;
      if (!Number.isFinite(employeeId) && !Number.isFinite(employeeNumber)) continue;
      result.push({
        employee_id: Number.isFinite(employeeId) ? employeeId : null,
        employee_number: Number.isFinite(employeeNumber) ? employeeNumber : null,
        store_number: store,
        href: link.href,
      });
    }
    return result;
  }, { storeNumber });
}

async function scrapeEmployeeTimeclock(
  page: Parameters<typeof ensureAuthenticated>[0],
  employee: EmployeeLink,
  config: ReturnType<typeof createFlexeposPayrollConfig>,
) {
  const detailConfig = {
    ...config,
    navigationTimeoutMs: Math.max(config.navigationTimeoutMs, 20_000),
    timeoutMs: Math.max(config.timeoutMs, 20_000),
  };
  await gotoWithRetry(page, employee.href, detailConfig);
  const adjust = page.locator("input[type='submit'][value='Adjust Time']").first();
  await adjust.waitFor({ state: "visible", timeout: detailConfig.timeoutMs });
  await adjust.click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const detail = await page.evaluate(() => {
    const text = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
    const body = text(document.body.textContent);
    const period = body.match(/Pay period:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] ?? null;
    const wanted = ["Date", "Start Time", "Adjusted Start Time", "End Time", "Adjusted End Time", "Worked Time"];
    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      const header = rows.findIndex((row) => wanted.every((heading) => [...row.children].some((cell) => text(cell.textContent) === heading)));
      if (header < 0) continue;
      return {
        actualPayPeriod: period,
        tableFound: true,
        rows: rows.slice(header + 1).map((row) => [...row.querySelectorAll("td")].map((cell) => text(cell.textContent)))
          .filter((cells) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[0] ?? ""))
          .map((cells) => ({ date: cells[0] ?? "", start_time: cells[1] ?? "", adjusted_start_time: cells[2] ?? "", end_time: cells[3] ?? "", adjusted_end_time: cells[4] ?? "", worked_time: cells[5] ?? "" })),
      };
    }
    return { actualPayPeriod: period, tableFound: false, rows: [] };
  }, undefined);
  return validateTimeclockResult({
    ...detail,
    rows: detail.rows as TimeclockRow[],
    expectedPayPeriodStart: config.startDate ?? "",
    expectedPayPeriodEnd: config.endDate ?? "",
  });
}

function parseRequest(body: RequestBody) {
  const runId = typeof body.run_id === "string" ? body.run_id.trim() : "";
  const storeNumber = typeof body.store_number === "string" ? body.store_number.trim() : "";
  const startDate = typeof body.start_date === "string" ? body.start_date : "";
  const endDate = typeof body.end_date === "string" ? body.end_date : "";
  if (!runId || !/^\d+$/.test(storeNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false as const, error: "Provide a run ID, numeric store, and ISO start/end dates." };
  }
  const completedKeys = new Set(
    Array.isArray(body.completed_employee_keys)
      ? body.completed_employee_keys.filter((value): value is string => typeof value === "string")
      : [],
  );
  return { ok: true as const, value: { runId, storeNumber, startDate, endDate, completedKeys } };
}

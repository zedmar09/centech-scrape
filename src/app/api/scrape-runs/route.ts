import { NextRequest, NextResponse } from "next/server";

import {
  createFlexeposPayrollConfig,
  runFlexeposPayrollScrape,
} from "@/lib/flexeposPayrollScraper";
import {
  createPayrollScraperConfig,
  scrapeStorePayrollHtml,
} from "@/lib/payrollScraper";
import {
  parseConcurrencyInput,
  parseReportTypeInput,
  parseStoreNumbersInput,
} from "@/lib/scrapeRequest";
import { runPayrollScrape } from "@/lib/scrapeRuns";
import { FLEXEPOS_REPORT_OPTIONS } from "@/lib/reportTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StartScrapeRequest = {
  stores?: unknown;
  concurrency?: unknown;
  end_date?: unknown;
  report_type?: unknown;
  start_date?: unknown;
};

export async function GET() {
  const scraperConfig = createPayrollScraperConfig();
  const stores =
    scraperConfig.source === "flexepos"
      ? createFlexeposPayrollConfig(process.env).stores
      : [];

  return NextResponse.json({
    batch_size: 2,
    reports: FLEXEPOS_REPORT_OPTIONS,
    store_numbers: stores,
  });
}

export async function POST(request: NextRequest) {
  let body: StartScrapeRequest;

  try {
    body = (await request.json()) as StartScrapeRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const stores = parseStoreNumbersInput(body.stores);
  const startDate = parseDateInput(body.start_date);
  const endDate = parseDateInput(body.end_date);
  const reportType = parseReportTypeInput(body.report_type);
  const scraperConfig = createPayrollScraperConfig();

  if (scraperConfig.source !== "flexepos" && stores.length === 0) {
    return NextResponse.json(
      { error: "Add at least one numeric store number before scraping." },
      { status: 400 },
    );
  }

  if (scraperConfig.source === "flexepos" && (!startDate || !endDate)) {
    return NextResponse.json(
      { error: "Select a start date and end date before scraping Flexepos." },
      { status: 400 },
    );
  }

  if (scraperConfig.source !== "flexepos" && reportType !== "payroll") {
    return NextResponse.json(
      { error: "Tip breakdown scraping is only available for Flexepos." },
      { status: 400 },
    );
  }

  try {
    const run =
      scraperConfig.source === "flexepos"
        ? await runFlexeposPayrollScrape({
            stores,
            config: createFlexeposPayrollConfig(process.env, {
              endDate,
              reportType,
              startDate,
            }),
          })
        : await runPayrollScrape({
            stores,
            concurrency: parseConcurrencyInput(body.concurrency),
            scrapeStoreHtml: (storeNumber) =>
              scrapeStorePayrollHtml(storeNumber, scraperConfig),
          });

    return NextResponse.json(run);
  } catch (caught) {
    return NextResponse.json(
      {
        error:
          caught instanceof Error
            ? caught.message
            : "Unable to complete this scrape run.",
      },
      { status: 500 },
    );
  }
}

function parseDateInput(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

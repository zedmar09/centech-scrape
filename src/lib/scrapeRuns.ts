import {
  PayrollParseResult,
  combinePayrollParseResults,
} from "./payrollParser";
import { parsePayrollHtmlOnServer } from "./serverPayrollParser";

export type ScrapeStoreStatus = "queued" | "scraping" | "parsing" | "done" | "error";

export type PayrollScrapeStoreResult = {
  store_number: string;
  status: ScrapeStoreStatus;
  rows: number;
  sections: number;
  warnings: string[];
  error?: string;
};

export type PayrollScrapeRunStatus = "done" | "completed_with_errors";

export type PayrollScrapeRun = {
  run_id: string;
  status: PayrollScrapeRunStatus;
  started_at: string;
  finished_at: string;
  store_results: PayrollScrapeStoreResult[];
  result: PayrollParseResult;
};

export type RunPayrollScrapeInput = {
  stores: string[];
  scrapeStoreHtml: (storeNumber: string) => Promise<string>;
  concurrency?: number;
  createRunId?: () => string;
  now?: () => Date;
};

type StoreWorkItem = {
  index: number;
  storeNumber: string;
};

type StoreWorkResult = {
  parseResult?: PayrollParseResult;
  storeResult: PayrollScrapeStoreResult;
};

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;

export async function runPayrollScrape({
  stores,
  scrapeStoreHtml,
  concurrency = DEFAULT_CONCURRENCY,
  createRunId = createDefaultRunId,
  now = () => new Date(),
}: RunPayrollScrapeInput): Promise<PayrollScrapeRun> {
  const normalizedStores = normalizeStoreNumbers(stores);

  if (normalizedStores.length === 0) {
    throw new Error("At least one store number is required to start scraping.");
  }

  const startedAt = now().toISOString();
  const workItems = normalizedStores.map<StoreWorkItem>((storeNumber, index) => ({
    index,
    storeNumber,
  }));
  const workerCount = Math.min(
    Math.max(1, Math.floor(concurrency)),
    MAX_CONCURRENCY,
    workItems.length,
  );
  const workResults = new Array<StoreWorkResult>(workItems.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < workItems.length) {
      const workItem = workItems[nextIndex];
      nextIndex += 1;
      workResults[workItem.index] = await scrapeAndParseStore(
        workItem.storeNumber,
        scrapeStoreHtml,
      );
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const successfulResults = workResults
    .map((workResult) => workResult.parseResult)
    .filter((result): result is PayrollParseResult => Boolean(result));
  const combinedResult = combinePayrollParseResults(successfulResults);
  const storeResults = workResults.map((workResult) => workResult.storeResult);
  const hasErrors = storeResults.some((storeResult) => storeResult.status === "error");

  return {
    run_id: createRunId(),
    status: hasErrors ? "completed_with_errors" : "done",
    started_at: startedAt,
    finished_at: now().toISOString(),
    store_results: storeResults,
    result: combinedResult,
  };
}

export function normalizeStoreNumbers(stores: string[]): string[] {
  const seen = new Set<string>();

  return stores
    .map((store) => store.trim())
    .filter((store) => store.length > 0)
    .filter((store) => {
      if (seen.has(store)) {
        return false;
      }

      seen.add(store);
      return true;
    });
}

async function scrapeAndParseStore(
  storeNumber: string,
  scrapeStoreHtml: (storeNumber: string) => Promise<string>,
): Promise<StoreWorkResult> {
  try {
    const html = await scrapeStoreHtml(storeNumber);
    const parseResult = parsePayrollHtmlOnServer(html);

    return {
      parseResult,
      storeResult: {
        store_number: storeNumber,
        status: "done",
        rows: parseResult.payload.length,
        sections: parseResult.sections.length,
        warnings: parseResult.warnings,
      },
    };
  } catch (caught) {
    return {
      storeResult: {
        store_number: storeNumber,
        status: "error",
        rows: 0,
        sections: 0,
        warnings: [],
        error:
          caught instanceof Error
            ? caught.message
            : "Unable to scrape and parse this store.",
      },
    };
  }
}

function createDefaultRunId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

  return `scrape_${suffix}`;
}

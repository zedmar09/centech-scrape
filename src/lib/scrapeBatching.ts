import {
  type FlexeposReportType,
  type ScrapePayload,
  combineScrapeParseResults,
} from "./reportTypes";
import type { PayrollScrapeRun, PayrollScrapeStoreResult } from "./scrapeRuns";

export const DEFAULT_SCRAPE_BATCH_SIZE = 2;

export type QueuedScrapeRunInput = {
  reportType?: FlexeposReportType;
  runId: string;
  startedAt: string;
  stores: string[];
};

export type FailedScrapeRunInput = {
  error: string;
  finishedAt: string;
  reportType?: FlexeposReportType;
  startedAt: string;
  stores: string[];
};

export type MergeScrapeRunOptions = {
  finishedAt: string;
};

export type ScrapeProgress = {
  completed: number;
  failed: number;
  percent: number;
  total: number;
};

export function chunkStoreNumbers(stores: string[], batchSize = DEFAULT_SCRAPE_BATCH_SIZE) {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];

  for (let index = 0; index < stores.length; index += size) {
    batches.push(stores.slice(index, index + size));
  }

  return batches;
}

export function createQueuedScrapeRun({
  reportType = "payroll",
  runId,
  startedAt,
  stores,
}: QueuedScrapeRunInput): PayrollScrapeRun {
  return {
    report_type: reportType,
    run_id: runId,
    status: "running",
    started_at: startedAt,
    finished_at: startedAt,
    store_results: stores.map((storeNumber) => ({
      store_number: storeNumber,
      status: "queued",
      rows: 0,
      sections: 0,
      warnings: [],
      scraped_html: null,
    })),
    result: {
      payload: [],
      sections: [],
      warnings: [],
    },
  };
}

export function markStoresScraping(
  run: PayrollScrapeRun,
  storeNumbers: string[],
): PayrollScrapeRun {
  const activeStores = new Set(storeNumbers);

  return {
    ...run,
    status: "running",
    store_results: run.store_results.map((storeResult) =>
      activeStores.has(storeResult.store_number)
        ? {
            ...storeResult,
            error: undefined,
            status: "scraping",
          }
        : storeResult,
    ),
  };
}

export function createFailedScrapeRun({
  error,
  finishedAt,
  reportType = "payroll",
  startedAt,
  stores,
}: FailedScrapeRunInput): PayrollScrapeRun {
  return {
    report_type: reportType,
    run_id: `failed_${stores.join("_")}`,
    status: "completed_with_errors",
    started_at: startedAt,
    finished_at: finishedAt,
    store_results: stores.map((storeNumber) => ({
      store_number: storeNumber,
      status: "error",
      rows: 0,
      sections: 0,
      warnings: [],
      scraped_html: null,
      error,
    })),
    result: {
      payload: [],
      sections: [],
      warnings: [],
    },
  };
}

export function mergeScrapeRunBatch(
  run: PayrollScrapeRun,
  batchRuns: PayrollScrapeRun[],
  { finishedAt }: MergeScrapeRunOptions,
): PayrollScrapeRun {
  const batchStoreResults = new Map<string, PayrollScrapeStoreResult>();

  for (const batchRun of batchRuns) {
    for (const storeResult of batchRun.store_results) {
      batchStoreResults.set(storeResult.store_number, storeResult);
    }
  }

  const storeResults = run.store_results.map(
    (storeResult) => batchStoreResults.get(storeResult.store_number) ?? storeResult,
  );
  const existingStoreNumbers = new Set(storeResults.map((store) => store.store_number));

  for (const storeResult of batchStoreResults.values()) {
    if (!existingStoreNumbers.has(storeResult.store_number)) {
      storeResults.push(storeResult);
    }
  }

  const replacedStoreNumbers = new Set(batchStoreResults.keys());
  const retainedSections = run.result.sections.filter((section) => {
    return !replacedStoreNumbers.has(String(section.store_number ?? ""));
  });
  const retainedResult = {
    ...run.result,
    sections: retainedSections,
    payload: retainedSections.flatMap(
      (section) => section.payload as ScrapePayload[],
    ),
  };
  const result = combineScrapeParseResults([
    retainedResult,
    ...batchRuns.map((batchRun) => batchRun.result),
  ]);
  const progress = getScrapeProgress({ ...run, store_results: storeResults });
  const status =
    progress.completed < progress.total
      ? "running"
      : progress.failed > 0
        ? "completed_with_errors"
        : "done";

  return {
    ...run,
    report_type: run.report_type ?? batchRuns[0]?.report_type,
    status,
    finished_at: status === "running" ? run.finished_at : finishedAt,
    store_results: storeResults,
    result,
  };
}

export function getScrapeProgress(run: PayrollScrapeRun): ScrapeProgress {
  const total = run.store_results.length;
  const completed = run.store_results.filter(
    (store) => store.status === "done" || store.status === "error",
  ).length;
  const failed = run.store_results.filter((store) => store.status === "error").length;

  return {
    completed,
    failed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    total,
  };
}

import { describe, expect, it } from "vitest";

import {
  chunkStoreNumbers,
  createFailedScrapeRun,
  createQueuedScrapeRun,
  getFailedStoreNumbers,
  getScrapeProgress,
  markStoresScraping,
  mergeScrapeRunBatch,
} from "./scrapeBatching";
import type { PayrollScrapeRun } from "./scrapeRuns";

function finishedRun(storeNumber: string, rows: number): PayrollScrapeRun {
  return {
    run_id: `run_${storeNumber}`,
    status: "done",
    started_at: "2026-06-20T00:00:00.000Z",
    finished_at: "2026-06-20T00:00:10.000Z",
    store_results: [
      {
        store_number: storeNumber,
        status: "done",
        rows,
        sections: 1,
        warnings: [],
        scraped_html: `<html>${storeNumber}</html>`,
      },
    ],
    result: {
      sections: [
        {
          store_number: Number(storeNumber),
          store_label: `Store ${storeNumber} payroll`,
          date_range: "06/01/2026 - 06/14/2026",
          payload: [
            {
              employee_id: Number(storeNumber),
              employee_number: Number(storeNumber) + 100,
              store_number: Number(storeNumber),
              regular_hours: rows,
              overtime_hours: 0,
            },
          ],
        },
      ],
      payload: [
        {
          employee_id: Number(storeNumber),
          employee_number: Number(storeNumber) + 100,
          store_number: Number(storeNumber),
          regular_hours: rows,
          overtime_hours: 0,
        },
      ],
      warnings: [],
    },
  };
}

describe("scrape batching helpers", () => {
  it("chunks store numbers into two-store batches", () => {
    expect(chunkStoreNumbers(["2006", "2017", "2020", "2023", "2024"], 2)).toEqual([
      ["2006", "2017"],
      ["2020", "2023"],
      ["2024"],
    ]);
  });

  it("marks the active batch while preserving queued stores", () => {
    const run = createQueuedScrapeRun({
      runId: "client_run",
      startedAt: "2026-06-20T00:00:00.000Z",
      stores: ["2006", "2017", "2020"],
    });

    const activeRun = markStoresScraping(run, ["2006", "2017"]);

    expect(activeRun.status).toBe("running");
    expect(activeRun.store_results.map((store) => store.status)).toEqual([
      "scraping",
      "scraping",
      "queued",
    ]);
  });

  it("merges one-store batch results and reports progress", () => {
    let run = createQueuedScrapeRun({
      runId: "client_run",
      startedAt: "2026-06-20T00:00:00.000Z",
      stores: ["2006", "2017", "2020", "2023"],
    });

    run = mergeScrapeRunBatch(run, [finishedRun("2006", 4), finishedRun("2017", 8)], {
      finishedAt: "2026-06-20T00:01:00.000Z",
    });

    expect(run.status).toBe("running");
    expect(run.result.payload).toHaveLength(2);
    expect(getScrapeProgress(run)).toEqual({
      completed: 2,
      failed: 0,
      percent: 50,
      total: 4,
    });
  });

  it("keeps going when a store request fails", () => {
    const run = createQueuedScrapeRun({
      runId: "client_run",
      startedAt: "2026-06-20T00:00:00.000Z",
      stores: ["2006", "2017"],
    });
    const failed = createFailedScrapeRun({
      error: "Browser session closed",
      finishedAt: "2026-06-20T00:00:30.000Z",
      startedAt: "2026-06-20T00:00:00.000Z",
      stores: ["2017"],
    });

    const merged = mergeScrapeRunBatch(run, [finishedRun("2006", 4), failed], {
      finishedAt: "2026-06-20T00:01:00.000Z",
    });

    expect(merged.status).toBe("completed_with_errors");
    expect(merged.store_results).toEqual([
      expect.objectContaining({ store_number: "2006", status: "done" }),
      expect.objectContaining({
        error: "Browser session closed",
        store_number: "2017",
        status: "error",
      }),
    ]);
    expect(getScrapeProgress(merged).percent).toBe(100);
  });

  it("returns failed store numbers in queue order for manual retry", () => {
    const run = createQueuedScrapeRun({
      runId: "client_run",
      startedAt: "2026-06-20T00:00:00.000Z",
      stores: ["2006", "2017", "2020", "2023"],
    });
    const failed = createFailedScrapeRun({
      error: "Browser session closed",
      finishedAt: "2026-06-20T00:00:30.000Z",
      startedAt: "2026-06-20T00:00:00.000Z",
      stores: ["2017", "2023"],
    });
    const merged = mergeScrapeRunBatch(run, [finishedRun("2006", 4), failed], {
      finishedAt: "2026-06-20T00:01:00.000Z",
    });

    expect(getFailedStoreNumbers(merged)).toEqual(["2017", "2023"]);
  });
});

import { describe, expect, it } from "vitest";

import { runPayrollScrape } from "./scrapeRuns";

function payrollHtml(storeNumber: string, employeeId: number) {
  return `
    <span class="header-text">Store ${storeNumber} payroll</span>
    <table>
      <thead>
        <tr>
          <th>Employee Name</th>
          <th>Employee Number</th>
          <th>Regular Hours</th>
          <th>Overtime Hours</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <a href="/detail?id=${employeeId}&amp;storeNumber=${storeNumber}">
              Employee ${employeeId}
            </a>
          </td>
          <td>${employeeId + 100}</td>
          <td>40.00</td>
          <td>1.50</td>
        </tr>
      </tbody>
    </table>
  `;
}

describe("runPayrollScrape", () => {
  it("scrapes stores, parses HTML immediately, and returns only payload data", async () => {
    const scrapedStores: string[] = [];

    const run = await runPayrollScrape({
      stores: ["2006", "3012"],
      createRunId: () => "run_test",
      now: () => new Date("2026-06-19T08:00:00.000Z"),
      scrapeStoreHtml: async (storeNumber) => {
        scrapedStores.push(storeNumber);
        return payrollHtml(storeNumber, storeNumber === "2006" ? 10 : 20);
      },
    });

    expect(scrapedStores).toEqual(["2006", "3012"]);
    expect(run.run_id).toBe("run_test");
    expect(run.status).toBe("done");
    expect(run.result.payload).toEqual([
      {
        employee_id: 10,
        employee_number: 110,
        store_number: 2006,
        regular_hours: 40,
        overtime_hours: 1.5,
      },
      {
        employee_id: 20,
        employee_number: 120,
        store_number: 3012,
        regular_hours: 40,
        overtime_hours: 1.5,
      },
    ]);
    expect(JSON.stringify(run)).not.toContain("<table>");
  });

  it("keeps going when one store fails to scrape", async () => {
    const run = await runPayrollScrape({
      stores: ["2006", "9999"],
      createRunId: () => "run_partial",
      scrapeStoreHtml: async (storeNumber) => {
        if (storeNumber === "9999") {
          throw new Error("Site timeout");
        }

        return payrollHtml(storeNumber, 55);
      },
    });

    expect(run.status).toBe("completed_with_errors");
    expect(run.result.payload).toHaveLength(1);
    expect(run.store_results).toEqual([
      expect.objectContaining({
        store_number: "2006",
        status: "done",
        rows: 1,
      }),
      expect.objectContaining({
        store_number: "9999",
        status: "error",
        error: "Site timeout",
      }),
    ]);
  });
});

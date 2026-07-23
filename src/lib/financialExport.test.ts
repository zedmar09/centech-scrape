import { describe, expect, it } from "vitest";
import { buildFinancialExport, categoryCode } from "./financialExport";

describe("financial database export", () => {
  it("creates stable category codes", () => {
    expect(categoryCode("3rd Party - UberEats")).toBe("3rd_party_ubereats");
    expect(categoryCode("Cash Over/Short Adjustment")).toBe("cash_over_short_adjustment");
  });

  it("creates flat database rows with decimal-safe values", () => {
    const result = buildFinancialExport({
      reportType: "sales",
      runId: "run-123",
      organization: "century",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      generatedAt: "2026-07-23T00:00:00.000Z",
      rows: [
        { date: "2026-07-01", store: "2006", transaction_category: "Subject to Tax", debit: 10.5, credit: null, balance_status: "", is_summary: false },
        { date: "2026-07-01", store: "2006", transaction_category: "Sales Tax", debit: null, credit: 10.5, balance_status: "", is_summary: false },
        { date: "2026-07-01", store: "2006", transaction_category: "SUMMARY", debit: 10.5, credit: 10.5, balance_status: "Balanced", is_summary: true },
      ],
    });

    expect(result.run.run_id).toBe("run-123");
    expect(result.run.source).toBe("flexepos_scrape");
    expect(result.rows).toEqual([
      {
        business_date: "2026-07-01",
        store_number: "2006",
        category_code: "subject_to_tax",
        category_name: "Subject to Tax",
        debit: "10.50",
        credit: null,
      },
      {
        business_date: "2026-07-01",
        store_number: "2006",
        category_code: "sales_tax",
        category_name: "Sales Tax",
        debit: null,
        credit: "10.50",
      },
    ]);
  });
});

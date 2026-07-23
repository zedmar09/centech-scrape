import { describe, expect, it } from "vitest";

import {
  SALES_CATEGORY_ORDER,
  createSalesJobs,
  summarizeSalesRows,
  toSalesComparisonRows,
  type CsdAggregate,
} from "./salesReport";

const aggregate: CsdAggregate = {
  schemaVersion: 3,
  store: "2006",
  date: "07/01/2026",
  sales: { "Taxable Sales": 100, "Non-Taxable Sales": 0, "Sales Tax": 8 },
  registerAuditCid: 0,
  registerAudit: 20,
  cashOverShort: 0,
  registerAuditAdjustment: 0,
  payout: 0,
  payin: 0,
  cards: { depositAmount: 88 },
  onlineCreditCard: { saleAmount: 0, tipAmount: 0 },
  onlineGiftCard: { saleAmount: 0, tipAmount: 0 },
  totalCreditCardTips: 0,
  thirdParty: [],
  giftCards: {},
  houseAccounts: [],
  donations: [],
};

describe("sales report contracts", () => {
  it("creates date-first store jobs", () => {
    const jobs = createSalesJobs({
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      organization: "century",
      stores: ["2006", "2016"],
    });
    expect(jobs.map((job) => `${job.business_date}|${job.store_number}`)).toEqual([
      "2026-07-01|2006",
      "2026-07-01|2016",
      "2026-07-02|2006",
      "2026-07-02|2016",
    ]);
  });

  it("omits zero categories and preserves template order", () => {
    const rows = toSalesComparisonRows(aggregate);
    expect(rows.map((row) => row.transaction_category)).toEqual([
      "Subject to Tax",
      "Register Audit",
      "Sales Tax",
      "In-Store Credit Card",
    ]);
    expect(rows.every((row) => SALES_CATEGORY_ORDER.includes(row.transaction_category as never))).toBe(true);
  });

  it("reports balanced or the larger side and difference", () => {
    const balanced = summarizeSalesRows([
      { date: "2026-07-01", store: "2006", transaction_category: "A", debit: 10, credit: null },
      { date: "2026-07-01", store: "2006", transaction_category: "B", debit: null, credit: 10 },
    ]);
    expect(balanced[0].balance_status).toBe("Balanced");

    const unbalanced = summarizeSalesRows([
      { date: "2026-07-01", store: "2006", transaction_category: "A", debit: 12.5, credit: null },
      { date: "2026-07-01", store: "2006", transaction_category: "B", debit: null, credit: 10 },
    ]);
    expect(unbalanced[0].balance_status).toBe("Debit +$2.50");
    expect(unbalanced[0].difference).toBe(2.5);
  });
});

import { describe, expect, it } from "vitest";
import { createRoyaltyJobs, toRoyaltyRows } from "./royaltyReport";

describe("royalty report contracts", () => {
  it("creates one range job per store", () => {
    expect(createRoyaltyJobs({ organization: "century", startDate: "2026-07-01", endDate: "2026-07-20", stores: ["2006", "2016"] })).toHaveLength(2);
  });

  it("creates balanced non-zero rows in template order", () => {
    const rows = toRoyaltyRows({ schemaVersion: 1, store: "2006", startDate: "2026-07-01", endDate: "2026-07-20", dateRange: "07/01/2026 - 07/20/2026", royaltySales: 1000, royalty: 65, advertising: 10, media: 40 });
    expect(rows.map((row) => row.transaction_category)).toEqual([
      "Royalty Fee", "Royalties Bank Acct Entry", "National Media Fee", "National Media Bank Entry",
      "Corporate Advertising Fee", "Corp Advertising Bank Acct Entry",
    ]);
    expect(rows.reduce((sum, row) => sum + (row.debit ?? 0), 0)).toBe(115);
    expect(rows.reduce((sum, row) => sum + (row.credit ?? 0), 0)).toBe(115);
  });
});

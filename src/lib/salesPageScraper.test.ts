import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

import { scrapeCsdPage, type SalesPage } from "./salesPageScraper";
import { toSalesComparisonRows } from "./salesReport";

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("CSD page extraction", () => {
  it("extracts a report and produces non-zero ordered rows", async () => {
    const dom = new JSDOM(`
      <body>
        <input id="parameters:store" value="2006">
        <input id="parameters:startDateCalendarInputDate" value="07/01/2026">
        <table id="salesBreakdown"><tbody>
          <tr><td>Taxable Sales</td><td>100.00</td></tr>
          <tr><td>Non-Taxable Sales</td><td>0.00</td></tr>
          <tr><td>Sales Tax</td><td>8.00</td></tr>
        </tbody></table>
        <table id="bankBreakdown">
          <thead><tr><th></th><th>Time</th><th>Type</th><th>Amount</th><th>Employee</th><th>Comment</th></tr></thead>
          <tbody>
            <tr><td>Bank Deposit</td><td>21:34</td><td>Bank Deposit</td><td>296.00</td><td>Ashley Gregory</td><td>eod 7/3</td></tr>
            <tr><td>Register Audit(CID)</td><td></td><td></td><td>295.46</td><td></td><td></td></tr>
          </tbody>
        </table>
        <table id="registerAudit"><thead><tr><th>Type</th><th>Amount</th><th>Comment</th></tr></thead>
          <tbody>
            <tr><td>Register Audit</td><td>20.00</td><td>Over/Short: 0.00</td></tr>
            <tr><td>Store Payout</td><td>44.00</td><td></td></tr>
            <tr><td>Register Audit</td><td>99.00</td><td>Over/Short: 1.25</td></tr>
          </tbody></table>
        <table class="table-standard"><thead><tr><th></th><th>Sale Amount</th><th>Tip Amount</th><th>Deposit Amount</th></tr></thead>
          <tbody><tr><td>Total</td><td>80.00</td><td>0.00</td><td>80.00</td></tr></tbody></table>
        <table class="table-standard"><thead><tr><th></th><th>Sale Amount</th><th>Tip Amount (Excluding WLD)</th><th>WLD Tip Amount</th><th>Deposit Amount</th></tr></thead>
          <tbody><tr><td>Online Credit Card Total</td><td>0</td><td>0</td><td>0</td><td>0</td></tr></tbody></table>
      </body>
    `);
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });

    const page: SalesPage = {
      evaluate: async (pageFunction) => pageFunction(),
      locator: (selector) => ({
        first() { return this; },
        inputValue: async () =>
          (dom.window.document.querySelector(selector) as HTMLInputElement | null)?.value ?? "",
        waitFor: async () => undefined,
      }),
    };

    const aggregate = await scrapeCsdPage(page, "2006", "07/01/2026");
    expect(aggregate.sales["Taxable Sales"]).toBe(100);
    expect(aggregate.registerAuditCid).toBe(295.46);
    expect(aggregate.cards.depositAmount).toBe(80);
    expect(aggregate.payout).toBe(44);
    expect(aggregate.registerAudit).toBe(20);
    expect(aggregate.cashOverShort).toBe(0);
    expect(toSalesComparisonRows(aggregate).map((row) => row.transaction_category)).toEqual([
      "Subject to Tax",
      "Register Audit",
      "Sales Tax",
      "In-Store Credit Card",
      "Payout",
    ]);
  });
});

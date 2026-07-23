import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { scrapeRoyaltyPage } from "./royaltyPageScraper";
import type { SalesPage } from "./salesPageScraper";

const originalDocument = globalThis.document;
afterEach(() => Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument }));

describe("royalty page extraction", () => {
  it("extracts the selected store and range", async () => {
    const dom = new JSDOM(`<body>07/01/2026 - 07/20/2026<table><thead><tr><th>Store</th><th>Royalty Sales</th><th>Royalty</th><th>%</th><th>Advertising</th><th>%</th><th>Media</th><th>%</th><th>Days</th><th>State ID</th></tr></thead><tbody><tr><td>2006</td><td>1,000.00</td><td>65.00</td><td>6.5</td><td>10.00</td><td>1</td><td>40.00</td><td>4</td><td>20</td><td>2</td></tr></tbody></table></body>`);
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
    const page: SalesPage = { evaluate: async (fn) => fn(), locator: () => ({ first() { return this; }, inputValue: async () => "", waitFor: async () => undefined }) };
    const result = await scrapeRoyaltyPage(page, "2006", "2026-07-01", "2026-07-20");
    expect(result).toMatchObject({ royaltySales: 1000, royalty: 65, advertising: 10, media: 40 });
  });
});

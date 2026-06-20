import { describe, expect, it } from "vitest";

import {
  buildPayrollStoreUrl,
  createPayrollScraperConfig,
} from "./payrollScraper";

describe("payrollScraper config", () => {
  it("defaults to the Flexepos full-flow scraper mode", () => {
    expect(createPayrollScraperConfig({}).source).toBe("flexepos");
  });

  it("builds a store URL from the configured template", () => {
    expect(
      buildPayrollStoreUrl(
        "https://payroll.example.test/reports?store={storeNumber}&type=payroll",
        "2006",
      ),
    ).toBe("https://payroll.example.test/reports?store=2006&type=payroll");
  });

  it("keeps scraper configuration server-side", () => {
    const config = createPayrollScraperConfig({
      PAYROLL_SCRAPER_SOURCE: "fetch",
      PAYROLL_SCRAPER_URL_TEMPLATE:
        "https://payroll.example.test/stores/{storeNumber}/payroll",
      PAYROLL_SCRAPER_COOKIE: "session=abc",
      PAYROLL_SCRAPER_HEADERS_JSON: JSON.stringify({
        "x-payroll-tenant": "demo",
      }),
    });

    expect(config).toEqual({
      source: "fetch",
      urlTemplate: "https://payroll.example.test/stores/{storeNumber}/payroll",
      readySelector: "table",
      timeoutMs: 30_000,
      headers: {
        cookie: "session=abc",
        "x-payroll-tenant": "demo",
      },
    });
  });

  it("can select the Flexepos full-flow scraper mode", () => {
    expect(
      createPayrollScraperConfig({
        PAYROLL_SCRAPER_SOURCE: "flexepos",
      }).source,
    ).toBe("flexepos");
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FLEXEPOS_STORE_NUMBERS,
  createFlexeposPayrollConfig,
  resolveRequestedStores,
} from "./flexeposPayrollScraper";

describe("flexeposPayrollScraper config", () => {
  it("uses the 87 configured payroll stores by default", () => {
    const config = createFlexeposPayrollConfig({});

    expect(config.stores).toHaveLength(87);
    expect(config.stores.slice(0, 5)).toEqual([
      "2006",
      "2016",
      "2017",
      "2020",
      "2023",
    ]);
    expect(config.stores.slice(-5)).toEqual([
      "49007",
      "49008",
      "49009",
      "49010",
      "49011",
    ]);
  });

  it("reads Flexepos credentials and remote browser settings from env", () => {
    const config = createFlexeposPayrollConfig({
      FMS_USERNAME: "demo-user",
      FMS_PASSWORD: "demo-password",
      STORE_NUMBERS: "2006, 3012, 2006",
      FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT: "wss://browser.example.test",
      FLEXEPOS_HEADLESS: "false",
    });

    expect(config).toEqual(
      expect.objectContaining({
        username: "demo-user",
        password: "demo-password",
        stores: ["2006", "3012"],
        browserWsEndpoint: "wss://browser.example.test",
        headless: false,
      }),
    );
  });

  it("does not read the dynamic payroll date range from env", () => {
    const config = createFlexeposPayrollConfig({
      START_DATE: "06/01/2026",
      END_DATE: "06/14/2026",
    });

    expect(config.startDate).toBeNull();
    expect(config.endDate).toBeNull();
  });

  it("uses UI/request date overrides and converts HTML date input for Flexepos", () => {
    const config = createFlexeposPayrollConfig(
      {
        START_DATE: "01/01/2026",
        END_DATE: "01/02/2026",
      },
      {
        startDate: "2026-06-01",
        endDate: "2026-06-14",
      },
    );

    expect(config.startDate).toBe("06/01/2026");
    expect(config.endDate).toBe("06/14/2026");
  });

  it("uses request stores when provided and falls back to env stores otherwise", () => {
    const config = createFlexeposPayrollConfig({
      STORE_NUMBERS: "2006,3012",
    });

    expect(resolveRequestedStores(["9999"], config)).toEqual(["9999"]);
    expect(resolveRequestedStores([], config)).toEqual(["2006", "3012"]);
  });

  it("exposes the Centech store list as comma-separated env content", () => {
    expect(DEFAULT_FLEXEPOS_STORE_NUMBERS.join(",")).toContain(
      "2006,2016,2017,2020,2023",
    );
  });

  it("uses the Centech table wait selector by default", () => {
    expect(createFlexeposPayrollConfig({}).selectors.payrollTable).toBe("table");
  });
});

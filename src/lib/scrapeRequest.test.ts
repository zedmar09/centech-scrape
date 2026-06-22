import { describe, expect, it } from "vitest";

import {
  createScrapeRunRequestBody,
  parseReportTypeInput,
  parseStoreNumbersInput,
} from "./scrapeRequest";

describe("parseStoreNumbersInput", () => {
  it("accepts pasted store numbers separated by commas, spaces, or new lines", () => {
    expect(parseStoreNumbersInput("2006, 3012\n9144 2006")).toEqual([
      "2006",
      "3012",
      "9144",
    ]);
  });

  it("accepts store arrays and ignores invalid entries", () => {
    expect(parseStoreNumbersInput(["2006", "abc", " 3012 ", ""])).toEqual([
      "2006",
      "3012",
    ]);
  });
});

describe("createScrapeRunRequestBody", () => {
  it("sends the selected pay-period dates", () => {
    expect(
      createScrapeRunRequestBody({
        endDate: "2026-06-15",
        startDate: "2026-06-01",
      }),
    ).toEqual({
      end_date: "2026-06-15",
      start_date: "2026-06-01",
    });
  });

  it("can target a specific store batch", () => {
    expect(
      createScrapeRunRequestBody({
        endDate: "2026-06-15",
        reportType: "payroll",
        startDate: "2026-06-01",
        stores: ["2006"],
      }),
    ).toEqual({
      end_date: "2026-06-15",
      report_type: "payroll",
      start_date: "2026-06-01",
      stores: ["2006"],
    });
  });

  it("can request the tip breakdown report target", () => {
    expect(
      createScrapeRunRequestBody({
        endDate: "2026-06-14",
        reportType: "tip-breakdown-report",
        startDate: "2026-06-01",
      }),
    ).toEqual({
      end_date: "2026-06-14",
      report_type: "tip-breakdown-report",
      start_date: "2026-06-01",
    });
  });
});

describe("parseReportTypeInput", () => {
  it("accepts known Flexepos report targets", () => {
    expect(parseReportTypeInput("tip-breakdown-report")).toBe(
      "tip-breakdown-report",
    );
  });

  it("defaults to payroll for missing or unknown report targets", () => {
    expect(parseReportTypeInput(undefined)).toBe("payroll");
    expect(parseReportTypeInput("unknown-report")).toBe("payroll");
  });
});

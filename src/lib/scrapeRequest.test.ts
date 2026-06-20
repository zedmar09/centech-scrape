import { describe, expect, it } from "vitest";

import {
  createScrapeRunRequestBody,
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
  it("sends only the selected pay-period dates", () => {
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
});

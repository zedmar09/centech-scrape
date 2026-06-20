import { describe, expect, it } from "vitest";

import { parseStoreNumbersInput } from "./scrapeRequest";

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

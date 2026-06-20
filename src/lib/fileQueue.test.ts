import { describe, expect, it } from "vitest";

import { createQueueEntriesFromStagedFiles, createStagedPayrollFiles } from "./fileQueue";

function makeFile(name: string, size: number, lastModified = 1000) {
  return {
    name,
    size,
    lastModified,
  } as File;
}

describe("fileQueue", () => {
  it("stages multiple files without marking them queued for parsing", () => {
    const stagedFiles = createStagedPayrollFiles([
      makeFile("store-2006.html", 1024),
      makeFile("store-3012.html", 2048),
    ]);

    expect(stagedFiles).toEqual([
      expect.objectContaining({
        name: "store-2006.html",
        size: 1024,
      }),
      expect.objectContaining({
        name: "store-3012.html",
        size: 2048,
      }),
    ]);
    expect(stagedFiles).not.toEqual([
      expect.objectContaining({
        status: "queued",
      }),
      expect.objectContaining({
        status: "queued",
      }),
    ]);
  });

  it("creates queued parse entries only when the user proceeds", () => {
    const stagedFiles = createStagedPayrollFiles([
      makeFile("store-2006.html", 1024),
      makeFile("store-3012.html", 2048),
    ]);

    const entries = createQueueEntriesFromStagedFiles(stagedFiles);

    expect(entries.map((entry) => entry.file.name)).toEqual([
      "store-2006.html",
      "store-3012.html",
    ]);
    expect(entries.map((entry) => entry.queuedFile.status)).toEqual([
      "queued",
      "queued",
    ]);
  });
});

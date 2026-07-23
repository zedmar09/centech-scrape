import type { SalesPage } from "./salesPageScraper";
import type { RoyaltyAggregate } from "./royaltyReport";

export async function scrapeRoyaltyPage(
  page: SalesPage,
  store: string,
  startDate: string,
  endDate: string,
  timeoutMs = 15_000,
): Promise<RoyaltyAggregate> {
  await page.locator("table").first().waitFor({ state: "visible", timeout: timeoutMs });
  const expectedRange = `${flexDate(startDate)} - ${flexDate(endDate)}`;
  const result = await page.evaluate(() => {
    const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
    const tables = [...document.querySelectorAll<HTMLTableElement>("table")];
    for (const table of tables) {
      const rows = [...table.querySelectorAll("tr")];
      const header = rows.map((row) => [...row.cells].map((cell) => clean(cell.textContent))).find((cells) =>
        cells.includes("Store") && cells.includes("Royalty Sales") && cells.includes("Royalty") &&
        cells.includes("Advertising") && cells.includes("Media"),
      );
      if (!header) continue;
      return {
        bodyText: clean(document.body.textContent),
        rows: rows.map((row) => [...row.cells].map((cell) => clean(cell.textContent))).filter((cells) => cells.length >= 10),
      };
    }
    return { bodyText: clean(document.body.textContent), rows: [] as string[][] };
  });
  if (!result.bodyText.includes(expectedRange)) {
    throw new Error(`Royalty date range mismatch: expected ${expectedRange}.`);
  }
  const row = result.rows.find((cells) => normalizeStore(cells[0]) === store);
  if (!row) throw new Error(`No royalty result row found for store ${store}.`);

  return {
    advertising: amount(row[4]),
    dateRange: expectedRange,
    endDate,
    media: amount(row[6]),
    royalty: amount(row[2]),
    royaltySales: amount(row[1]),
    schemaVersion: 1,
    startDate,
    store,
  };
}

function flexDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

function normalizeStore(value: string) {
  return String(value ?? "").trim().replace(/\.0$/, "").split(/[ -]/)[0];
}

function amount(value: string) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1"));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid royalty amount: ${value}`);
  return parsed;
}

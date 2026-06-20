const STORE_NUMBER_PATTERN = /^\d+$/;

export type ScrapeRunRequestDates = {
  endDate: string;
  startDate: string;
  stores?: string[];
};

export function createScrapeRunRequestBody({
  endDate,
  startDate,
  stores,
}: ScrapeRunRequestDates) {
  return {
    end_date: endDate,
    start_date: startDate,
    ...(stores && stores.length > 0 ? { stores } : {}),
  };
}

export function parseStoreNumbersInput(value: unknown): string[] {
  const rawStores = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  const seen = new Set<string>();

  return rawStores
    .map((store) => store.trim())
    .filter((store) => STORE_NUMBER_PATTERN.test(store))
    .filter((store) => {
      if (seen.has(store)) {
        return false;
      }

      seen.add(store);
      return true;
    });
}

export function parseConcurrencyInput(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.floor(value);
}

import type { SalesOrganization } from "./salesReport";

export const ROYALTY_CATEGORY_ORDER = [
  "Royalty Fee",
  "Royalties Bank Acct Entry",
  "National Media Fee",
  "National Media Bank Entry",
  "Corporate Advertising Fee",
  "Corp Advertising Bank Acct Entry",
] as const;

export type RoyaltyJob = {
  organization: SalesOrganization;
  start_date: string;
  end_date: string;
  store_number: string;
  attempts: number;
};

export type RoyaltyAggregate = {
  schemaVersion: 1;
  store: string;
  startDate: string;
  endDate: string;
  dateRange: string;
  royaltySales: number;
  royalty: number;
  advertising: number;
  media: number;
};

export type RoyaltyRow = {
  date: string;
  store: string;
  transaction_category: string;
  debit: number | null;
  credit: number | null;
};

export function createRoyaltyJobs({ organization, startDate, endDate, stores }: {
  organization: SalesOrganization; startDate: string; endDate: string; stores: string[];
}): RoyaltyJob[] {
  return stores.map((store) => ({ attempts: 0, organization, start_date: startDate, end_date: endDate, store_number: store }));
}

export function royaltyJobKey(job: RoyaltyJob) {
  return `${job.organization}|${job.start_date}|${job.end_date}|${job.store_number}`;
}

export function toRoyaltyRows(result: RoyaltyAggregate): RoyaltyRow[] {
  const range = `${result.startDate} - ${result.endDate}`;
  const pairs: Array<[string, number, "debit" | "credit"]> = [
    ["Royalty Fee", result.royalty, "debit"],
    ["Royalties Bank Acct Entry", result.royalty, "credit"],
    ["National Media Fee", result.media, "debit"],
    ["National Media Bank Entry", result.media, "credit"],
    ["Corporate Advertising Fee", result.advertising, "debit"],
    ["Corp Advertising Bank Acct Entry", result.advertising, "credit"],
  ];
  return pairs.flatMap(([category, raw, side]) => {
    const value = Math.round((Number(raw) || 0) * 100) / 100;
    return value === 0 ? [] : [{
      credit: side === "credit" ? value : null,
      date: range,
      debit: side === "debit" ? value : null,
      store: result.store,
      transaction_category: category,
    }];
  });
}

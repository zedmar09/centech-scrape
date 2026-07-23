import type { SalesOrganization } from "./salesReport";

export type FinancialExportRow = {
  date: string;
  store: string;
  transaction_category: string;
  debit: number | null;
  credit: number | null;
  balance_status: string;
  is_summary: boolean;
};

type ExportOptions = {
  runId?: string;
  reportType: "sales" | "royalties";
  organization: SalesOrganization;
  startDate: string;
  endDate: string;
  rows: FinancialExportRow[];
  generatedAt?: string;
};

function decimal(value: number | null) {
  return value == null ? null : value.toFixed(2);
}

export function categoryCode(category: string) {
  return category
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildFinancialExport({
  reportType,
  organization,
  startDate,
  endDate,
  rows,
  runId,
  generatedAt = new Date().toISOString(),
}: ExportOptions) {
  const exportRows = rows
    .filter((row) => !row.is_summary)
    .map((row) => ({
      ...(reportType === "sales"
        ? { business_date: row.date }
        : { start_date: startDate, end_date: endDate }),
      store_number: row.store,
        category_code: categoryCode(row.transaction_category),
        category_name: row.transaction_category,
        debit: decimal(row.debit),
        credit: decimal(row.credit),
    }));

  return {
    schema_version: 1,
    run: {
      run_id: runId ?? `${reportType}_${startDate.replaceAll("-", "")}_${endDate.replaceAll("-", "")}_${organization}`,
      report_type: reportType,
      organization,
      start_date: startDate,
      end_date: endDate,
      generated_at: generatedAt,
      source: "flexepos_scrape",
    },
    rows: exportRows,
  };
}

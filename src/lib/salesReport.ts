export const SALES_CATEGORY_ORDER = [
  "Subject to Tax",
  "Non-Taxable Sales",
  "3rd Party Tax Exempt",
  "Tax Exempt",
  "Register Audit",
  "Sales Tax",
  "In-Store Credit Card",
  "Payout",
  "Online Credit card",
  "Online Gift Card",
  "Online Credit Card Tips",
  "In-Store Credit Card Tips",
  "Online Gift Card Tips",
  "Gift Card",
  "Gift Card Sold",
  "3rd Party - UberEats",
  "3rd Party - DoorDash",
  "3rd Party - GrubHub",
  "3rd Party - EZ Cater",
  "House Account",
  "Donation",
  "Payin",
  "Cash Over/Short Adjustment",
  "Discarded CC",
  "Register Audit Adjustment",
] as const;

export type SalesOrganization = "century" | "century_austin";

export type SalesJob = {
  organization: SalesOrganization;
  business_date: string;
  store_number: string;
  attempts: number;
};

export type SalesComparisonRow = {
  date: string;
  store: string;
  transaction_category: string;
  debit: number | null;
  credit: number | null;
};

export type SalesBalanceSummary = {
  date: string;
  store: string;
  total_debit: number;
  total_credit: number;
  difference: number;
  balance_status: string;
};

export type CsdAggregate = {
  schemaVersion: 3;
  store: string;
  date: string;
  sales: Record<string, number>;
  registerAuditCid: number;
  registerAudit: number;
  cashOverShort: number;
  registerAuditAdjustment: number;
  discardedCreditCard?: number;
  payout: number;
  payin: number;
  cards: { depositAmount: number };
  onlineCreditCard: { saleAmount: number; tipAmount: number };
  onlineGiftCard: { saleAmount: number; tipAmount: number };
  totalCreditCardTips: number;
  thirdParty: Array<{ paymentName: string; total: number }>;
  giftCards: Record<string, number>;
  houseAccounts: Array<{ amount: number }>;
  donations: Array<{ total: number }>;
};

export function createSalesJobs({
  endDate,
  organization,
  startDate,
  stores,
}: {
  endDate: string;
  organization: SalesOrganization;
  startDate: string;
  stores: string[];
}): SalesJob[] {
  const dates = datesBetween(startDate, endDate);
  return dates.flatMap((businessDate) =>
    stores.map((storeNumber) => ({
      attempts: 0,
      business_date: businessDate,
      organization,
      store_number: storeNumber,
    })),
  );
}

export function salesJobKey(job: Pick<SalesJob, "organization" | "business_date" | "store_number">) {
  return `${job.organization}|${job.business_date}|${job.store_number}`;
}

export function toSalesComparisonRows(result: CsdAggregate): SalesComparisonRow[] {
  const values = new Map<string, { debit: number; credit: number }>();
  const add = (category: string, debit = 0, credit = 0) => {
    const roundedDebit = cents(debit) / 100;
    const roundedCredit = cents(credit) / 100;
    if (roundedDebit === 0 && roundedCredit === 0) return;
    values.set(category, { debit: roundedDebit, credit: roundedCredit });
  };

  add("Subject to Tax", 0, result.sales["Taxable Sales"]);
  const nonTax = result.sales["Non-Taxable Sales"] || 0;
  add("Non-Taxable Sales", nonTax < 0 ? Math.abs(nonTax) : 0, nonTax > 0 ? nonTax : 0);
  add("3rd Party Tax Exempt", 0, result.sales["3rd Party Tax Exempt Sales"]);
  add("Tax Exempt", 0, result.sales["Tax Exempt Sales"]);
  add("Register Audit", result.registerAudit);
  add("Sales Tax", 0, result.sales["Sales Tax"]);
  add("In-Store Credit Card", result.cards.depositAmount);
  add("Payout", result.payout);
  add("Online Credit card", result.onlineCreditCard.saleAmount + result.onlineCreditCard.tipAmount);
  add("Online Gift Card", result.onlineGiftCard.saleAmount + result.onlineGiftCard.tipAmount);
  add("Online Credit Card Tips", 0, result.onlineCreditCard.tipAmount);
  add(
    "In-Store Credit Card Tips",
    0,
    result.totalCreditCardTips - result.onlineCreditCard.tipAmount - result.onlineGiftCard.tipAmount,
  );
  add("Online Gift Card Tips", 0, result.onlineGiftCard.tipAmount);
  add("Gift Card", result.giftCards["Gift Cards Redeemed"]);
  add("Gift Card Sold", 0, result.giftCards["Gift Cards Sold"]);

  const thirdPartyNames: Record<string, string> = {
    DoorDash: "3rd Party - DoorDash",
    GrubHub: "3rd Party - GrubHub",
    UberEats: "3rd Party - UberEats",
    "EZ Cater": "3rd Party - EZ Cater",
  };
  for (const item of result.thirdParty) {
    add(thirdPartyNames[item.paymentName] ?? `3rd Party - ${item.paymentName}`, item.total);
  }

  add("House Account", result.houseAccounts.reduce((sum, item) => sum + item.amount, 0));
  add("Donation", 0, result.donations.reduce((sum, item) => sum + item.total, 0));
  add("Payin", 0, result.payin);

  let cashOverShort = result.cashOverShort || 0;
  let auditAdjustment = result.registerAuditAdjustment || 0;
  if (!result.registerAudit && !cashOverShort && !auditAdjustment && result.registerAuditCid) {
    const whole = Math.trunc(result.registerAuditCid);
    auditAdjustment = -whole;
    cashOverShort = -Math.round((result.registerAuditCid - whole) * 100) / 100;
  }
  add("Cash Over/Short Adjustment", cashOverShort < 0 ? Math.abs(cashOverShort) : 0, cashOverShort > 0 ? cashOverShort : 0);
  add("Discarded CC", result.discardedCreditCard || 0);
  add("Register Audit Adjustment", auditAdjustment < 0 ? Math.abs(auditAdjustment) : 0, auditAdjustment > 0 ? auditAdjustment : 0);

  const date = isoFromFlexDate(result.date);
  return SALES_CATEGORY_ORDER.flatMap((category) => {
    const value = values.get(category);
    return value
      ? [{
          credit: value.credit || null,
          date,
          debit: value.debit || null,
          store: result.store,
          transaction_category: category,
        }]
      : [];
  });
}

export function summarizeSalesRows(rows: SalesComparisonRow[]): SalesBalanceSummary[] {
  const groups = new Map<string, { date: string; store: string; debit: number; credit: number }>();
  for (const row of rows) {
    const key = `${row.date}|${row.store}`;
    const group = groups.get(key) ?? { date: row.date, store: row.store, debit: 0, credit: 0 };
    group.debit += cents(row.debit || 0);
    group.credit += cents(row.credit || 0);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const differenceInCents = group.debit - group.credit;
    return {
      balance_status:
        differenceInCents === 0
          ? "Balanced"
          : `${differenceInCents > 0 ? "Debit" : "Credit"} +${formatCurrency(Math.abs(differenceInCents) / 100)}`,
      date: group.date,
      difference: differenceInCents / 100,
      store: group.store,
      total_credit: group.credit / 100,
      total_debit: group.debit / 100,
    };
  });
}

function cents(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function isoFromFlexDate(value: string) {
  const [month, day, year] = value.split("/");
  return year ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : value;
}

function datesBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) {
    throw new Error("The sales date range is invalid.");
  }
  const dates: string[] = [];
  for (let date = start; date <= end; date = new Date(date.valueOf() + 86_400_000)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

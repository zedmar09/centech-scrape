import type { CsdAggregate } from "./salesReport";

type Locator = {
  first: () => Locator;
  inputValue: () => Promise<string>;
  waitFor: (options: { state: "visible"; timeout?: number }) => Promise<void>;
};

export type SalesPage = {
  evaluate: <T>(pageFunction: () => T) => Promise<T>;
  locator: (selector: string) => Locator;
};

export async function scrapeCsdPage(
  page: SalesPage,
  expectedStore: string,
  expectedDate: string,
  timeoutMs = 15_000,
): Promise<CsdAggregate> {
  await page.locator("#salesBreakdown").waitFor({ state: "visible", timeout: timeoutMs });
  const store = (await page.locator("#parameters\\:store").inputValue()).trim();
  const date = await page.locator("#parameters\\:startDateCalendarInputDate").inputValue();

  if (store !== expectedStore) {
    throw new Error(`CSD store mismatch: expected ${expectedStore}, received ${store}`);
  }
  if (date !== expectedDate) {
    throw new Error(`CSD date mismatch: expected ${expectedDate}, received ${date}`);
  }

  const extracted = await page.evaluate(() => {
    const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
    const maybeAmount = (value: unknown) => {
      const normalized = clean(value).replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1");
      if (!normalized) return null;
      if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const amount = (value: unknown) => {
      if (!clean(value)) return 0;
      const parsed = maybeAmount(value);
      if (parsed == null) throw new Error(`Invalid monetary value: ${clean(value)}`);
      return parsed;
    };
    const records = (table: HTMLTableElement | null) => {
      if (!table) return [] as Array<Record<string, string>>;
      const headers = [...(table.tHead?.rows[0]?.cells ?? [])].map((cell) => clean(cell.textContent));
      return [...(table.tBodies[0]?.rows ?? [])].map((row) => {
        const cells = [...row.cells].map((cell) => clean(cell.textContent));
        return Object.fromEntries(headers.map((header, index) => [header || "Name", cells[index] || ""]));
      });
    };
    const keyed = (selector: string) => {
      const table = document.querySelector<HTMLTableElement>(selector);
      if (!table) return {} as Record<string, number>;
      return Object.fromEntries(
        [...table.querySelectorAll(":scope > tbody > tr")]
          .map((row) => [...row.children].map((cell) => clean(cell.textContent)))
          .filter((cells) => cells[0])
          .map((cells) => [
            cells[0],
            cells.slice(1).map(maybeAmount).find((value) => value != null) ?? 0,
          ]),
      );
    };
    const findStandardTable = (headers: string[]) =>
      [...document.querySelectorAll<HTMLTableElement>("table.table-standard")].find((table) => {
        const actual = [...(table.tHead?.rows[0]?.cells ?? [])].map((cell) => clean(cell.textContent));
        return headers.every((header) => actual.includes(header));
      }) ?? null;

    const sales = keyed("#salesBreakdown");
    const giftCards = keyed("#giftcardBreakdown");
    const bank = keyed("#bankBreakdown");
    const registerRows = records(document.querySelector<HTMLTableElement>("#registerAudit"));
    const thirdParty = records(document.querySelector<HTMLTableElement>("#thirdpartyBreakdown"));
    const donations = records(document.querySelector<HTMLTableElement>("#donationBreakdown"));
    const houseAccounts = records(document.querySelector<HTMLTableElement>("#houseBreakdown"));
    const cardRows = records(findStandardTable(["Sale Amount", "Tip Amount", "Deposit Amount"]));
    const onlineRows = records(
      findStandardTable(["Sale Amount", "Tip Amount (Excluding WLD)", "WLD Tip Amount", "Deposit Amount"]),
    );
    const cardTotal = cardRows.find((row) => clean(row.Name) === "Total") ?? {};
    const onlineCredit = onlineRows.find((row) => clean(row.Name) === "Online Credit Card Total") ?? {};
    const onlineGift = onlineRows.find((row) => clean(row.Name) === "Online Gift Card Total") ?? {};
    const totalTipsMatch = clean(document.body.innerText).match(/Total Credit Card Tips\s+([$ ,\d.-]+)/i);

    let registerAudit = 0;
    let foundRegisterAudit = false;
    let overShort = 0;
    let payin = 0;
    let payout = 0;
    for (const row of registerRows) {
      const rowAmount = amount(row.Amount);
      const rowType = clean(row.Type).toLowerCase();
      if (rowType === "payins") payin += rowAmount;
      if (rowType === "store payout") payout += Math.abs(rowAmount);
      const match = clean(row.Comment).match(/Over\/Short:\s*([-0-9.]+)/i);
      if (!match || foundRegisterAudit) continue;
      const rowOverShort = amount(match[1]);
      if (Math.abs(rowAmount - rowOverShort) < 0.0001) continue;
      registerAudit = rowAmount;
      overShort = rowOverShort;
      foundRegisterAudit = true;
    }

    return {
      bank,
      cards: { depositAmount: amount(cardTotal["Deposit Amount"]) },
      cashOverShort: Math.round((overShort - Math.trunc(overShort)) * 100) / 100,
      donations: donations.map((row) => ({ total: amount(row.Total) })),
      giftCards,
      houseAccounts: houseAccounts.map((row) => ({ amount: amount(row.Amount) })),
      onlineCreditCard: {
        saleAmount: amount(onlineCredit["Sale Amount"]),
        tipAmount: amount(onlineCredit["Tip Amount (Excluding WLD)"]),
      },
      onlineGiftCard: {
        saleAmount: amount(onlineGift["Sale Amount"]),
        tipAmount: amount(onlineGift["Tip Amount (Excluding WLD)"]),
      },
      payin,
      payout,
      registerAudit,
      registerAuditAdjustment: Math.trunc(overShort),
      sales,
      thirdParty: thirdParty.map((row) => ({ paymentName: clean(row["Payment Name"]), total: amount(row.Total) })),
      totalCreditCardTips: amount(totalTipsMatch?.[1]),
    };
  });

  return {
    schemaVersion: 3,
    store,
    date,
    sales: extracted.sales,
    registerAuditCid: extracted.bank["Register Audit(CID)"] || 0,
    registerAudit: extracted.registerAudit,
    cashOverShort: extracted.cashOverShort,
    registerAuditAdjustment: extracted.registerAuditAdjustment,
    payout: extracted.payout,
    payin: extracted.payin,
    cards: extracted.cards,
    onlineCreditCard: extracted.onlineCreditCard,
    onlineGiftCard: extracted.onlineGiftCard,
    totalCreditCardTips: extracted.totalCreditCardTips,
    thirdParty: extracted.thirdParty.filter((row) => row.paymentName),
    giftCards: extracted.giftCards,
    houseAccounts: extracted.houseAccounts,
    donations: extracted.donations,
  };
}

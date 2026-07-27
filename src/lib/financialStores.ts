import flexeposConfig from "../config/flexepos.config.json";
import type { SalesOrganization } from "./salesReport";

export const AUSTIN_FINANCIAL_STORES = [
  "4028", "4041", "4055", "4062", "4064", "4071", "4078", "4079", "4089",
  "5124", "10013", "10023", "37017", "37019",
] as const;

const EXCLUDED_CENTURY_FINANCIAL_STORES = new Set(["4083"]);

export const CENTURY_FINANCIAL_STORES = flexeposConfig.storeNumbers.filter(
  (store) => !EXCLUDED_CENTURY_FINANCIAL_STORES.has(store),
);

export function financialStores(organization: SalesOrganization): readonly string[] {
  return organization === "century"
    ? CENTURY_FINANCIAL_STORES
    : AUSTIN_FINANCIAL_STORES;
}

export function isConfiguredFinancialStore(
  organization: SalesOrganization,
  storeNumber: string,
) {
  return financialStores(organization).includes(storeNumber);
}

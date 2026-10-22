import { CsvRowData } from "../presets/types";

/**
 * Detects all unique currencies from IBKR CSV data
 *
 * IBKR exports have two sections:
 * - Section 1 (summary): Shows currency breakdown with LevelOfDetail = "Currency"
 * - Section 2 (transactions): Shows all transactions with base currency in CurrencyPrimary
 *
 * We ONLY read from Section 1 (summary) to get the actual currency list.
 *
 * @param parsedData - Array of parsed CSV rows
 * @returns Sorted array of unique currency codes
 */
export function detectCurrenciesFromIBKR(parsedData: CsvRowData[]): string[] {
  const currenciesSet = new Set<string>();

  for (const row of parsedData) {
    // ONLY read from summary section rows (LevelOfDetail = "Currency")
    // This avoids picking up column names or base currency from transaction section
    if (row.LevelOfDetail === "Currency") {
      const currency = row.CurrencyPrimary?.trim();
      if (currency && currency.length > 0 && currency !== "Currency") {
        currenciesSet.add(currency);
      }
    }
  }

  // Flex Query statements have no currency summary rows; there CurrencyPrimary
  // on each execution/detail row is that transaction's own currency.
  if (currenciesSet.size === 0) {
    for (const row of parsedData) {
      const level = row.LevelOfDetail?.trim().toUpperCase();
      if (level !== "EXECUTION" && level !== "DETAIL") continue;
      const currency = row.CurrencyPrimary?.trim();
      if (currency && /^[A-Z]{3}$/.test(currency)) {
        currenciesSet.add(currency);
      }
    }
  }

  // Convert to array and sort alphabetically
  return Array.from(currenciesSet).sort();
}

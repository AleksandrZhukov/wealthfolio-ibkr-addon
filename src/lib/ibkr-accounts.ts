import type { Account } from "@wealthfolio/addon-sdk";
import type { CsvRowData } from "../presets/types";

/** Rows of one IBKR account (ClientAccountID) within a statement. */
export interface IbkrAccountPartition {
  /** IBKR ClientAccountID, or "" when the export has no account column */
  ibkrAccount: string;
  /** AccountAlias when set in IBKR, otherwise the ClientAccountID */
  label: string;
  rows: CsvRowData[];
}

/**
 * Split statement rows by IBKR account so each one maps to its own
 * Wealthfolio accounts. Order follows first appearance in the statement.
 */
export function partitionByIbkrAccount(rows: CsvRowData[]): IbkrAccountPartition[] {
  const partitions = new Map<string, IbkrAccountPartition>();
  for (const row of rows) {
    const ibkrAccount = row.ClientAccountID?.trim() ?? "";
    let partition = partitions.get(ibkrAccount);
    if (!partition) {
      partition = { ibkrAccount, label: ibkrAccount, rows: [] };
      partitions.set(ibkrAccount, partition);
    }
    const alias = row.AccountAlias?.trim();
    if (alias && partition.label === ibkrAccount) partition.label = alias;
    partition.rows.push(row);
  }
  return [...partitions.values()];
}

/** "IBKR" + "Main" → "IBKR-Main"; no label keeps the plain group name. */
export function accountNamePrefix(groupName: string, label?: string): string {
  return label ? `${groupName}-${label}` : groupName;
}

/**
 * Find the Wealthfolio account for an IBKR account and currency. The IBKR
 * account number is stored as accountNumber, so a renamed account still
 * matches; the name is the fallback for accounts created without it.
 */
export function findIbkrAccount(
  accounts: Account[],
  target: { ibkrAccount?: string; name: string; currency: string }
): Account | undefined {
  return (
    (target.ibkrAccount
      ? accounts.find((a) => a.currency === target.currency && a.accountNumber === target.ibkrAccount)
      : undefined) ?? accounts.find((a) => a.name === target.name && a.currency === target.currency)
  );
}

import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import { generateAccountNames } from "./account-name-generator";
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
  target: { ibkrAccount?: string; name: string; currency: string },
): Account | undefined {
  return (
    (target.ibkrAccount
      ? accounts.find(
          (a) => a.currency === target.currency && a.accountNumber === target.ibkrAccount,
        )
      : undefined) ?? accounts.find((a) => a.name === target.name && a.currency === target.currency)
  );
}

/**
 * Get or create accounts for each currency in an account group
 */
export async function getOrCreateAccountsForGroup(
  api: Pick<AddonContext["api"], "accounts" | "logger">,
  accountGroup: string,
  currencies: string[],
  ibkr?: { ibkrAccount: string; label: string },
): Promise<Map<string, Account>> {
  const accountsByCurrency = new Map<string, Account>();

  // Get existing accounts
  const allAccounts = (await api.accounts?.getAll()) || [];
  const groupAccounts = allAccounts.filter((a) => a.group === accountGroup);
  const ibkrAccount = ibkr?.ibkrAccount || undefined;

  // Generate expected account names
  const expectedNames = generateAccountNames(
    accountGroup,
    currencies,
    ibkrAccount ? ibkr?.label : undefined,
  );

  for (const expected of expectedNames) {
    // Check if account exists (by IBKR account number, then by name)
    const existing = findIbkrAccount(groupAccounts, { ...expected, ibkrAccount });

    if (existing) {
      accountsByCurrency.set(expected.currency, existing);
    } else {
      // Create new account
      try {
        const newAccount = await api.accounts?.create({
          name: expected.name,
          currency: expected.currency,
          group: accountGroup,
          accountNumber: ibkrAccount,
          accountType: "SECURITIES",
          trackingMode: "TRANSACTIONS",
          isDefault: false,
          isActive: true,
        });
        if (newAccount) {
          accountsByCurrency.set(expected.currency, newAccount);
          api.logger?.info(`Created account: ${expected.name}`);
        } else {
          // API returned null/undefined without throwing - treat as error
          api.logger?.error(`Failed to create account ${expected.name}: API returned null`);
        }
      } catch (e) {
        api.logger?.error(`Failed to create account ${expected.name}: ${e}`);
      }
    }
  }

  return accountsByCurrency;
}

import { describe, it, expect } from "vitest";
import type { Account } from "@wealthfolio/addon-sdk";
import { partitionByIbkrAccount, findIbkrAccount, accountNamePrefix } from "../lib/ibkr-accounts";
import { generateAccountNames } from "../lib/account-name-generator";

describe("partitionByIbkrAccount", () => {
  it("splits rows by ClientAccountID and labels each with its alias", () => {
    const parts = partitionByIbkrAccount([
      { ClientAccountID: "U1", AccountAlias: "", lineNumber: "1" },
      { ClientAccountID: "U2", AccountAlias: "Main", lineNumber: "2" },
      { ClientAccountID: "U1", AccountAlias: "", lineNumber: "3" },
    ]);
    expect(parts.map((p) => [p.ibkrAccount, p.label, p.rows.length])).toEqual([
      ["U1", "U1", 2],
      ["U2", "Main", 1],
    ]);
  });

  it("keeps exports without an account column in one unlabeled partition", () => {
    const parts = partitionByIbkrAccount([{ lineNumber: "1" }, { lineNumber: "2" }]);
    expect(parts).toEqual([{ ibkrAccount: "", label: "", rows: [{ lineNumber: "1" }, { lineNumber: "2" }] }]);
  });
});

describe("account naming and lookup", () => {
  it("names accounts after the IBKR alias", () => {
    expect(accountNamePrefix("IBKR", "Main")).toBe("IBKR-Main");
    expect(generateAccountNames("IBKR", ["USD"], "Main")).toEqual([{ currency: "USD", name: "IBKR-Main - USD", group: "IBKR" }]);
    expect(generateAccountNames("IBKR", ["USD"])).toEqual([{ currency: "USD", name: "IBKR - USD", group: "IBKR" }]);
  });

  it("finds a renamed account by IBKR account number before falling back to name", () => {
    const accounts = [
      { id: "byName", name: "IBKR-Main - USD", currency: "USD" },
      { id: "byNumber", name: "Renamed", currency: "USD", accountNumber: "U2" },
      { id: "otherCcy", name: "X", currency: "EUR", accountNumber: "U2" },
    ] as Account[];
    expect(findIbkrAccount(accounts, { ibkrAccount: "U2", name: "IBKR-Main - USD", currency: "USD" })?.id).toBe("byNumber");
    expect(findIbkrAccount(accounts, { name: "IBKR-Main - USD", currency: "USD" })?.id).toBe("byName");
  });
});

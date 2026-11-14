import { describe, it, expect, vi } from "vitest";
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { convertToActivityImports } from "../lib/activity-converter";
import { clearCollidingSourceIds } from "../lib/import-orchestrator";

const previews = [{ currency: "USD", name: "IBKR - USD" }];
const depositRow = (extra: Record<string, string> = {}) => ({
  _IBKR_TYPE: "IBKR_DEPOSIT",
  TradeMoney: "1000",
  CurrencyPrimary: "USD",
  Date: "2026-11-10",
  ActivityDescription: "CASH RECEIPTS",
  ...extra,
});

const row = (currency: string, sourceRecordId: string): ActivityImport =>
  ({
    accountId: "",
    date: "2026-11-10",
    symbol: `$CASH-${currency}`,
    activityType: "DEPOSIT",
    currency,
    sourceRecordId,
    isDraft: false,
    isValid: true,
  }) as ActivityImport;

describe("source record IDs", () => {
  it("puts the TransactionID in sourceRecordId and keeps the comment tag", async () => {
    const { activities } = await convertToActivityImports(
      [depositRow({ TransactionID: "123" })],
      previews,
    );
    expect(activities[0].sourceRecordId).toBe("123");
    expect(activities[0].comment).toMatch(/\[IBKR 123\]$/);
  });

  it("sends no ID for a row without TransactionID", async () => {
    const { activities } = await convertToActivityImports([depositRow()], previews);
    expect(activities).toHaveLength(1);
    expect("sourceRecordId" in activities[0]).toBe(false);
  });

  it("clears IDs that collide in one currency account and warns once", () => {
    const warn = vi.fn();
    const out = clearCollidingSourceIds([row("USD", "7"), row("USD", "7"), row("EUR", "7")], warn);
    expect(out.map((a) => a.sourceRecordId)).toEqual([undefined, undefined, "7"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

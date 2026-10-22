import { describe, it, expect, vi } from "vitest";
import { parseSplitRatio, preprocessIBKRData } from "../lib/ibkr-preprocessor";
import { convertToActivityImports } from "../lib/activity-converter";

vi.stubGlobal("fetch", () => Promise.reject(new Error("network disabled")));

const corporateAction = (description: string, extra: Record<string, string> = {}) => ({
  ClientAccountID: "U1",
  CurrencyPrimary: "USD",
  AssetClass: "STK",
  Symbol: "NFLX",
  Description: description,
  Date: "2025-11-17",
  Type: "FS",
  Quantity: "54",
  lineNumber: "1",
  ...extra,
});

describe("stock splits from IBKR corporate actions", () => {
  it("parses forward and reverse split ratios", () => {
    expect(parseSplitRatio("NFLX(US64110L1061) SPLIT 10 FOR 1 (NFLX, NETFLIX INC, US64110L1061)")).toBe(10);
    expect(parseSplitRatio("XYZ(US0000000000) SPLIT 1 FOR 20 (XYZ.OLD, XYZ CORP, US0000000000)")).toBe(0.05);
    expect(parseSplitRatio("AAPL(US0378331005) CASH DIVIDEND USD 0.26 PER SHARE")).toBeUndefined();
  });

  it("imports a forward split as a SPLIT activity with the ratio as amount", async () => {
    const { processedData } = preprocessIBKRData([corporateAction("NFLX(US64110L1061) SPLIT 10 FOR 1 (NFLX, NETFLIX INC, US64110L1061)")] as any);
    const previews = [{ currency: "USD", name: "T - USD", existingAccount: { id: "a", name: "T - USD", currency: "USD" } }];
    const { activities } = await convertToActivityImports(processedData as any, previews as any);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ activityType: "SPLIT", symbol: "NFLX", amount: 10, quantity: 0, date: "2025-11-17" });
  });

  it("takes the date from Date/Time when the Corporate Actions row has no Date", async () => {
    const row = corporateAction("NFLX(US64110L1061) SPLIT 10 FOR 1 (NFLX, NETFLIX INC, US64110L1061)", { Date: "", TradeDate: "2025-11-14 202500" });
    const { processedData } = preprocessIBKRData([row] as any);
    const previews = [{ currency: "USD", name: "T - USD", existingAccount: { id: "a", name: "T - USD", currency: "USD" } }];
    const { activities, errors } = await convertToActivityImports(processedData as any, previews as any);
    expect(errors).toEqual([]);
    expect(activities[0]).toMatchObject({ activityType: "SPLIT", amount: 10, date: "2025-11-14" });
  });

  it("applies a reverse split posted as two rows only once", () => {
    const desc = "XYZ(US0000000000) SPLIT 1 FOR 20 (XYZ.OLD, XYZ CORP, US0000000000)";
    const { processedData } = preprocessIBKRData([
      corporateAction(desc, { Symbol: "XYZ", Type: "RS", Quantity: "-200" }),
      corporateAction(desc, { Symbol: "XYZ", Type: "RS", Quantity: "10" }),
    ] as any);
    expect(processedData.filter((r: any) => r._IBKR_TYPE === "IBKR_SPLIT")).toHaveLength(1);
  });
});

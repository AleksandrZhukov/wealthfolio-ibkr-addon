import { describe, it, expect, vi } from "vitest";
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { importValidated } from "../lib/validated-import";

const row = (symbol: string, extra: Partial<ActivityImport> = {}): ActivityImport =>
  ({
    accountId: "a",
    activityType: "BUY",
    symbol,
    isDraft: false,
    isValid: true,
    ...extra,
  }) as ActivityImport;

describe("importValidated", () => {
  it("imports only rows that pass checkImport and reports host counts", async () => {
    const api = {
      checkImport: vi.fn(async (rows: ActivityImport[]) => [
        { ...rows[0], quoteCcy: "USD", instrumentType: "EQUITY" },
        { ...rows[1], isValid: false, errors: { symbol: ["Unknown symbol"] } },
      ]),
      import: vi.fn(async (rows: ActivityImport[]) => ({
        activities: rows,
        importRunId: "r",
        summary: {
          total: rows.length,
          imported: rows.length,
          skipped: 0,
          duplicates: 0,
          assetsCreated: 1,
          success: true,
        },
      })),
    };
    const result = await importValidated(api, [row("AAPL"), row("ZZZZ")]);
    expect(api.import).toHaveBeenCalledWith([
      expect.objectContaining({ symbol: "AAPL", quoteCcy: "USD" }),
    ]);
    expect(result).toEqual({
      imported: 1,
      duplicates: 0,
      failed: 1,
      errors: ["ZZZZ symbol: Unknown symbol"],
    });
  });

  it("reports a rejected batch instead of counting it as imported", async () => {
    const api = {
      checkImport: vi.fn(async (rows: ActivityImport[]) => rows),
      import: vi.fn(async (rows: ActivityImport[]) => ({
        activities: rows.map((r) => ({
          ...r,
          errors: { quoteCcy: ["Price currency (quoteCcy) is required"] },
        })),
        importRunId: "",
        summary: {
          total: rows.length,
          imported: 0,
          skipped: rows.length,
          duplicates: 0,
          assetsCreated: 0,
          success: false,
        },
      })),
    };
    const result = await importValidated(api, [row("AAPL")]);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("quoteCcy");
  });
});

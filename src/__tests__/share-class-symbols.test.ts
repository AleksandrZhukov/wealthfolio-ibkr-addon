import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("fetch", () => Promise.reject(new Error("network disabled")));

describe("IBKR share-class symbols", () => {
  it("resolves 'BRK B' to BRK-B instead of a similarly named ETF", async () => {
    const { resolveTicker } = await import("../lib/ticker-resolver");
    const searchFn = async () => [
      { symbol: "BRKU", name: "Direxion Daily BRKB Bull 2X Shares", exchange: "NYSE" },
      { symbol: "BRK-B", name: "Berkshire Hathaway Inc.", exchange: "NYSE" },
    ];
    const result = await resolveTicker(
      { isin: "US0846707026", symbol: "BRK B", exchange: "NYSE" } as any,
      { searchFn } as any,
    );
    expect(result.yahooTicker).toBe("BRK-B");
  });

  it("falls back to the dashed Yahoo form when search finds nothing", async () => {
    const { resolveTicker } = await import("../lib/ticker-resolver");
    const result = await resolveTicker(
      { isin: "US0846707026", symbol: "BRK B", exchange: "NYSE" } as any,
      { searchFn: async () => [] } as any,
    );
    expect(result.yahooTicker).toBe("BRK-B");
  });
});

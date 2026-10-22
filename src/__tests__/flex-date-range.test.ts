import { describe, it, expect } from "vitest";
import { splitFlexDateRange } from "../lib/flex-query-fetcher";

describe("splitFlexDateRange", () => {
  it("splits a multi-year range into contiguous chunks of at most 365 days", () => {
    const ranges = splitFlexDateRange(new Date("2023-01-01"), new Date("2026-10-22"));
    expect(ranges[0]).toEqual({ fromDate: "20230101", toDate: "20231231" });
    expect(ranges[1]).toEqual({ fromDate: "20240101", toDate: "20241230" });
    expect(ranges[ranges.length - 1].toDate).toBe("20261022");

    const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    for (let i = 0; i < ranges.length; i++) {
      const span = (day(ranges[i].toDate) - day(ranges[i].fromDate)) / 86_400_000 + 1;
      expect(span).toBeLessThanOrEqual(365);
      if (i > 0) expect(day(ranges[i].fromDate) - day(ranges[i - 1].toDate)).toBe(86_400_000);
    }
  });

  it("returns a single chunk for a short range and none when from is after to", () => {
    expect(splitFlexDateRange(new Date("2026-10-01"), new Date("2026-10-22"))).toEqual([
      { fromDate: "20261001", toDate: "20261022" },
    ]);
    expect(splitFlexDateRange(new Date("2026-10-23"), new Date("2026-10-22"))).toEqual([]);
  });
});

describe("getFlexStatement format check", () => {
  it("rejects an XML statement with a hint to switch the query to CSV", async () => {
    const { getFlexStatement, setHttpClient } = await import("../lib/flex-query-fetcher");
    setHttpClient({
      fetch: async () => ({
        ok: true,
        status: 200,
        status_text: "200",
        headers: {},
        body: `<FlexQueryResponse queryName="wealthfolio" type="AF">\n<FlexStatements count="0"/>\n</FlexQueryResponse>`,
      }),
    });
    const result = await getFlexStatement({ token: "t", queryId: "1" }, "ref");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CSV/);
  });
});

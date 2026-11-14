import { describe, it, expect } from "vitest";
import { getSyncRange } from "../lib/sync-range";

describe("getSyncRange", () => {
  const now = new Date("2026-11-14T15:00:00Z");

  it("uses the query Period on a first sync without historyFrom", () =>
    expect(getSyncRange({}, now)).toEqual({ from: null, to: "2026-11-13" }));
  it("starts a first sync at historyFrom", () =>
    expect(getSyncRange({ historyFrom: "2020-01-01" }, now)).toEqual({
      from: "2020-01-01",
      to: "2026-11-13",
    }));
  it("overlaps the last sync by 7 days and ignores historyFrom", () =>
    expect(getSyncRange({ historyFrom: "2020-01-01", syncedThrough: "2026-11-10" }, now)).toEqual({
      from: "2026-11-03",
      to: "2026-11-13",
    }));
  it("does not clamp a gap longer than a year", () =>
    expect(getSyncRange({ syncedThrough: "2024-01-10" }, now)).toEqual({
      from: "2024-01-03",
      to: "2026-11-13",
    }));
  it("clamps from to yesterday when historyFrom is today", () =>
    expect(getSyncRange({ historyFrom: "2026-11-14" }, now)).toEqual({
      from: "2026-11-13",
      to: "2026-11-13",
    }));
  it("computes yesterday in UTC", () =>
    expect(getSyncRange({}, new Date("2026-11-14T02:00:00Z")).to).toBe("2026-11-13"));
});

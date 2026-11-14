import type { FlexQueryConfig } from "./flex-config-storage";

/** Days re-fetched before `syncedThrough`, so late IBKR corrections still reach the import. */
export const SYNC_OVERLAP_DAYS = 7;

/** Inclusive `YYYY-MM-DD` dates; `from: null` means "use the query's own Period". */
export interface SyncRange {
  from: string | null;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetch window for a connection. `to` is always yesterday (UTC) because IBKR
 * builds activity statements end-of-day. No 365-day clamp: the fetcher splits
 * long ranges into chunks.
 */
export function getSyncRange(
  config: Pick<FlexQueryConfig, "historyFrom" | "syncedThrough">,
  now: Date,
): SyncRange {
  const to = utcDate(new Date(now.getTime() - DAY_MS));
  const from = config.syncedThrough
    ? utcDate(new Date(Date.parse(config.syncedThrough) - SYNC_OVERLAP_DAYS * DAY_MS))
    : (config.historyFrom ?? null);
  return { from: from !== null && from > to ? to : from, to };
}

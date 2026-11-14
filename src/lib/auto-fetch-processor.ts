/**
 * Auto-fetch Processor
 *
 * Handles the processing of a single Flex Query config during auto-fetch.
 * Extracted from performAutoFetch to improve testability and reduce complexity.
 */

import { importValidated } from "./validated-import";
import type { Account, AddonContext, ActivityImport } from "@wealthfolio/addon-sdk";
import type { CsvRowData } from "../presets/types";
import { fetchFlexQuery, fetchFlexQueryRange } from "./flex-query-fetcher";
import { parseFlexQueryCSV } from "./flex-csv-parser";
import { detectCurrenciesFromIBKR } from "./currency-detector";
import { accountNamePrefix, partitionByIbkrAccount } from "./ibkr-accounts";
import { processAndResolveData } from "./import-orchestrator";
import { deduplicateActivities } from "./activity-deduplicator";
import {
  createActivityFingerprintGetter,
  createSuccessStatus,
  createErrorStatus,
  formatImportResultMessage,
  enrichIBKRErrorMessage,
} from "./auto-fetch-helpers";
import { updateConfigStatus } from "./flex-config-storage";
import type { FlexQueryConfig } from "./flex-config-storage";
import { AsyncLock } from "./async-lock";
import { getSyncRange, type SyncRange } from "./sync-range";

/** One sync at a time across auto-fetch and `Sync now`, so two runs never import the same window. */
export const syncLock = new AsyncLock();

/**
 * Toast function type from sonner library (injected by host app)
 */
type ToastFn = {
  (message: string, options?: { id?: string; description?: string }): void;
  loading: (message: string, options?: { id?: string }) => void;
  success: (message: string, options?: { id?: string; description?: string }) => void;
  warning: (message: string, options?: { id?: string; description?: string }) => void;
  error: (message: string, options?: { id?: string; description?: string }) => void;
};

/**
 * Get the host app's toast function safely
 * Returns undefined if not available (e.g., during tests)
 */
function getToast(): ToastFn | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as { __wealthfolio_toast__?: ToastFn };
  return win.__wealthfolio_toast__;
}

/**
 * Result of processing a single config
 */
export interface ConfigProcessResult {
  success: boolean;
  imported: number;
  skipped: number;
  failed: number;
  failedAccounts: string[];
  error?: string;
}

/**
 * Dependencies needed to process a config
 */
export interface ProcessConfigDeps {
  ctx: AddonContext;
  token: string;
  getOrCreateAccountsForGroup: (
    accountGroup: string,
    currencies: string[],
    ibkr?: { ibkrAccount: string; label: string },
  ) => Promise<Map<string, Account>>;
  onProgress?: (message: string) => void;
}

/**
 * Fetch and parse CSV from IBKR Flex Query for `range`. A failed range chunk
 * fails the whole fetch: the chunks that did arrive are discarded, so a
 * partial window is never imported.
 */
export async function fetchAndParseFlexQuery(
  token: string,
  queryId: string,
  configName: string,
  logger: AddonContext["api"]["logger"] | undefined,
  range: SyncRange,
  onProgress?: (message: string) => void,
): Promise<{ success: true; rows: CsvRowData[] } | { success: false; error: string }> {
  const progress = (msg: string) => {
    logger?.trace(`IBKR auto-fetch [${configName}]: ${msg}`);
    onProgress?.(msg);
  };

  let csvs: string[];
  if (range.from === null) {
    const result = await fetchFlexQuery({ token, queryId }, { onProgress: progress });
    if (!result.success || !result.csv) {
      return { success: false, error: result.error || "Fetch failed" };
    }
    csvs = [result.csv];
  } else {
    const result = await fetchFlexQueryRange(
      { token, queryId },
      new Date(range.from),
      new Date(range.to),
      progress,
    );
    if (!result.success) {
      return { success: false, error: result.error || "Fetch failed" };
    }
    csvs = result.csvs;
  }

  const rows: CsvRowData[] = [];
  for (const csv of csvs) {
    if (!csv.trim()) continue;
    const parsed = parseFlexQueryCSV(csv);
    if (parsed.errors.length > 0) {
      logger?.warn(`IBKR auto-fetch [${configName}]: Parse warnings: ${parsed.errors.join(", ")}`);
    }
    rows.push(...parsed.rows);
  }

  return { success: true, rows };
}

/**
 * Import activities to accounts with deduplication
 */
export async function importActivitiesToAccounts(
  activities: ActivityImport[],
  currencies: string[],
  accountsByCurrency: Map<string, Account>,
  activitiesApi: AddonContext["api"]["activities"],
  configName: string,
  logger?: AddonContext["api"]["logger"],
): Promise<{ imported: number; skipped: number; failed: number; failedAccounts: string[] }> {
  let totalImported = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const failedAccounts: string[] = [];

  for (const currency of currencies) {
    const account = accountsByCurrency.get(currency);
    if (!account) continue;

    // Filter activities for this currency account
    const currencyActivities = activities.filter((a) => a.currency === currency);
    if (currencyActivities.length === 0) continue;

    // Set accountId on each activity
    const activitiesWithAccountId = currencyActivities.map((a) => ({
      ...a,
      accountId: account.id,
    }));

    // Deduplicate and import
    if (activitiesWithAccountId.length > 0 && activitiesApi) {
      try {
        // Deduplicate before importing
        const getExistingFingerprints = createActivityFingerprintGetter(activitiesApi);
        const { toImport, duplicatesSkipped } = await deduplicateActivities(
          activitiesWithAccountId,
          account.id,
          getExistingFingerprints,
        );

        totalSkipped += duplicatesSkipped;

        if (toImport.length > 0) {
          const outcome = await importValidated(activitiesApi, toImport);
          totalImported += outcome.imported;
          totalSkipped += outcome.duplicates;
          if (outcome.failed > 0) {
            totalFailed += outcome.failed;
            failedAccounts.push(account.name);
            logger?.warn(
              `IBKR auto-fetch [${configName}]: ${outcome.failed} rejected for ${account.name}: ${outcome.errors.slice(0, 3).join("; ")}`,
            );
          }
          logger?.trace(
            `IBKR auto-fetch [${configName}]: Imported ${outcome.imported} to ${account.name}`,
          );
        }

        if (duplicatesSkipped > 0) {
          logger?.trace(
            `IBKR auto-fetch [${configName}]: Skipped ${duplicatesSkipped} duplicates for ${account.name}`,
          );
        }
      } catch (importError) {
        const failedCount = activitiesWithAccountId.length;
        totalFailed += failedCount;
        failedAccounts.push(account.name);
        logger?.warn(
          `IBKR auto-fetch [${configName}]: Import error for ${account.name} (${failedCount} activities): ${importError}`,
        );
      }
    }
  }

  return { imported: totalImported, skipped: totalSkipped, failed: totalFailed, failedAccounts };
}

/**
 * Process a single Flex Query config
 * This is the main entry point extracted from performAutoFetch
 */
export async function processFlexQueryConfig(
  config: FlexQueryConfig,
  deps: ProcessConfigDeps,
): Promise<ConfigProcessResult> {
  const { ctx, token, getOrCreateAccountsForGroup } = deps;
  const range = getSyncRange(config, new Date());
  const toastId = `ibkr-fetch-${config.id}`;
  const toast = getToast();

  try {
    // Show loading toast
    toast?.loading(`IBKR: Fetching ${config.name}...`, { id: toastId });

    // 1. Fetch and parse CSV
    const fetchResult = await fetchAndParseFlexQuery(
      token,
      config.queryId,
      config.name,
      ctx.api.logger,
      range,
      deps.onProgress,
    );

    if (!fetchResult.success) {
      throw new Error(fetchResult.error);
    }

    const rows = fetchResult.rows;

    // Handle empty results
    if (rows.length === 0) {
      ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: No transactions found`);
      try {
        await updateConfigStatus(ctx.api.secrets, config.id, {
          ...createSuccessStatus(),
          syncedThrough: range.to,
        });
      } catch (saveError) {
        ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save status`);
      }
      toast?.success(`IBKR: ${config.name}`, {
        id: toastId,
        description: "No new transactions found",
      });
      return { success: true, imported: 0, skipped: 0, failed: 0, failedAccounts: [] };
    }

    // 2-4. Each IBKR account imports into its own currency accounts
    const importResult = { imported: 0, skipped: 0, failed: 0, failedAccounts: [] as string[] };
    for (const partition of partitionByIbkrAccount(rows)) {
      const ibkrLabel = partition.ibkrAccount ? partition.label : undefined;
      const currencies = detectCurrenciesFromIBKR(partition.rows);
      const accountsByCurrency = await getOrCreateAccountsForGroup(
        config.accountGroup,
        currencies,
        partition.ibkrAccount
          ? { ibkrAccount: partition.ibkrAccount, label: partition.label }
          : undefined,
      );

      // Build account previews for processAndResolveData
      const accountPreviews = currencies.map((currency) => ({
        currency,
        name: `${accountNamePrefix(config.accountGroup, ibkrLabel)} - ${currency}`,
        group: config.accountGroup,
        isNew: false,
        existingAccount: accountsByCurrency.get(currency),
      }));

      // Process data using shared logic (preprocess, resolve tickers, convert, split FX)
      const processResult = await processAndResolveData(
        partition.rows,
        accountPreviews,
        ctx.api.market?.searchTicker,
      );

      // Log conversion errors if any
      if (processResult.conversionErrors.length > 0) {
        const errorSummary = processResult.conversionErrors
          .slice(0, 5)
          .map((e) => e.message)
          .join("; ");
        ctx.api.logger?.warn(
          `IBKR auto-fetch [${config.name}]: ${processResult.conversionErrors.length} conversion error(s): ${errorSummary}`,
        );
      }

      // Import activities with deduplication
      const partitionResult = await importActivitiesToAccounts(
        processResult.activities,
        currencies,
        accountsByCurrency,
        ctx.api.activities,
        config.name,
        ctx.api.logger,
      );
      importResult.imported += partitionResult.imported;
      importResult.skipped += partitionResult.skipped;
      importResult.failed += partitionResult.failed;
      importResult.failedAccounts.push(...partitionResult.failedAccounts);
    }

    // 5. Update config status. Rejected rows keep syncedThrough, so the next sync retries the window.
    try {
      await updateConfigStatus(
        ctx.api.secrets,
        config.id,
        importResult.failed === 0
          ? { ...createSuccessStatus(), syncedThrough: range.to }
          : createSuccessStatus(),
      );
    } catch (saveError) {
      ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save success status`);
    }

    const resultMessage = formatImportResultMessage(
      importResult.imported,
      importResult.skipped,
      importResult.failed,
    );
    ctx.api.logger?.info(`IBKR auto-fetch [${config.name}]: Complete - ${resultMessage}`);

    // Log failed accounts if any
    if (importResult.failedAccounts.length > 0) {
      ctx.api.logger?.warn(
        `IBKR auto-fetch [${config.name}]: Failed accounts: ${importResult.failedAccounts.join(", ")}`,
      );
    }

    // Show success or warning toast based on results
    if (importResult.failed > 0) {
      toast?.warning(`IBKR: ${config.name}`, {
        id: toastId,
        description: resultMessage,
      });
    } else {
      toast?.success(`IBKR: ${config.name}`, {
        id: toastId,
        description: resultMessage,
      });
    }

    return {
      success: true,
      imported: importResult.imported,
      skipped: importResult.skipped,
      failed: importResult.failed,
      failedAccounts: importResult.failedAccounts,
    };
  } catch (error) {
    const errorStatus = createErrorStatus(error);
    // Enrich the error message with actionable guidance for known IBKR errors
    const userFriendlyError = enrichIBKRErrorMessage(errorStatus.lastFetchError || "Unknown error");
    ctx.api.logger?.error(
      `IBKR auto-fetch [${config.name}]: Error - ${errorStatus.lastFetchError}`,
    );

    // Show error toast with enriched message
    toast?.error(`IBKR: ${config.name} failed`, {
      id: toastId,
      description: userFriendlyError,
    });

    // Update config with error status (keep original error for debugging)
    try {
      await updateConfigStatus(ctx.api.secrets, config.id, {
        ...errorStatus,
        lastFetchError: userFriendlyError, // Store the user-friendly message
      });
    } catch (saveError) {
      ctx.api.logger?.warn(`IBKR auto-fetch [${config.name}]: Failed to save error status`);
    }

    return {
      success: false,
      imported: 0,
      skipped: 0,
      failed: 0,
      failedAccounts: [],
      error: userFriendlyError,
    };
  }
}

/** Run one sync for `config` under `syncLock`; `"busy"` when another sync is running. */
export async function syncNow(
  config: FlexQueryConfig,
  deps: ProcessConfigDeps,
): Promise<ConfigProcessResult | "busy"> {
  const release = syncLock.tryAcquire();
  if (!release) return "busy";
  try {
    return await processFlexQueryConfig(config, deps);
  } finally {
    release();
  }
}

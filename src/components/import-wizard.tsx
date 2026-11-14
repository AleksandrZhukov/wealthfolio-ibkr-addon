import { Card } from "@wealthfolio/ui";
import type { Account, AddonContext, ActivityImport } from "@wealthfolio/addon-sdk";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { debug } from "../lib/debug-logger";
import { getErrorMessage } from "../lib/shared-utils";
import { detectCurrenciesFromIBKR } from "../lib/currency-detector";
import { generateAccountNames } from "../lib/account-name-generator";
import { dropHostDuplicates, importValidated } from "../lib/validated-import";
import { accountNamePrefix, findIbkrAccount, partitionByIbkrAccount } from "../lib/ibkr-accounts";
import {
  refreshAndUpdateAccountPreviews,
  processAndResolveData,
  fetchExistingActivitiesForDedup,
  deduplicateActivities,
  groupActivitiesByCurrency,
  createTransactionGroups,
} from "../lib/import-orchestrator";
import StepIndicator from "./step-indicator";
import { useMultiCsvParser } from "../hooks/use-multi-csv-parser";
import { IBKRSourceSelectionStep } from "./ibkr-source-selection-step";
import { IBKRCurrencyPreviewStep } from "./ibkr-currency-preview-step";
import { IBKRTickerPreviewStep } from "./ibkr-ticker-preview-step";
import { IBKRImportResultsStep } from "./ibkr-import-results-step";
import { CsvRowData } from "../presets/types";
import type { AccountPreview, TransactionGroup, ImportResult, ProgressInfo } from "../types";

const STEPS = [
  { id: 1, title: "Source & Group" },
  { id: 2, title: "Currency Accounts" },
  { id: 3, title: "Transaction Preview" },
  { id: 4, title: "Import Results" },
];

/** Totals of a finished import, summed over all account groups. */
export interface WizardOutcome {
  imported: number;
  failed: number;
}

export interface ImportWizardProps {
  ctx: AddonContext;
  /** Rows already fetched (first sync of a connection); the wizard opens at step 2. */
  initial?: { groupName: string; rows: CsvRowData[] };
  /** `null` when the user leaves before importing. */
  onClose: (outcome: WizardOutcome | null) => void;
}

export const ImportWizard: React.FC<ImportWizardProps> = ({ ctx, initial, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Step 1: Source selection state
  const [groupName, setGroupName] = useState(initial?.groupName ?? "");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Parsed CSV rows
  const [parsedData, setParsedData] = useState<CsvRowData[]>([]);

  // CSV Parser hook (for manual uploads)
  const {
    data: manualParsedData,
    errors: parsingErrors,
    isParsing,
    parseMultipleCsvFiles,
  } = useMultiCsvParser();

  // Step 2 state
  const [accountPreviews, setAccountPreviews] = useState<AccountPreview[]>([]);

  // Step 3 state
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionProgress, setResolutionProgress] = useState<ProgressInfo | undefined>();
  const [transactionGroups, setTransactionGroups] = useState<TransactionGroup[]>([]);

  // Step 4 state
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ProgressInfo | undefined>();
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  // Track if component is mounted (for async operation cleanup)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load accounts
  useEffect(() => {
    const loadData = async () => {
      if (!ctx?.api) return;

      // Load accounts
      if (ctx.api.accounts) {
        try {
          const allAccounts = await ctx.api.accounts.getAll();
          if (!isMountedRef.current) return;
          setAccounts(allAccounts);
        } catch (e) {
          debug.error("Failed to load accounts:", e);
        }
      }

      if (isMountedRef.current) setAccountsLoaded(true);
    };

    loadData();
  }, [ctx]);

  // Get unique groups from accounts (memoized to avoid recalculation on every render)
  const existingGroups = useMemo(
    () => [...new Set(accounts.map((a) => a.group).filter(Boolean))] as string[],
    [accounts],
  );

  // Process parsed data and advance to step 2 (memoized to prevent stale closures)
  const processDataToStep2 = useCallback(
    (data: CsvRowData[]) => {
      // One set of currency accounts per IBKR account, named after its alias
      const previews = partitionByIbkrAccount(data).flatMap((partition) => {
        const ibkrLabel = partition.ibkrAccount ? partition.label : undefined;
        const currencies = detectCurrenciesFromIBKR(partition.rows);
        return generateAccountNames(groupName, currencies, ibkrLabel).map((acc) => {
          const preview = { ...acc, ibkrAccount: partition.ibkrAccount || undefined, ibkrLabel };
          return {
            ...preview,
            transactionCount: partition.rows.filter((row) => row.CurrencyPrimary === acc.currency)
              .length,
            existingAccount: findIbkrAccount(accounts, preview),
          };
        });
      });

      setAccountPreviews(previews);
      setIsLoadingData(false);
      setLoadingMessage("");
      setCurrentStep(2);
    },
    [groupName, accounts],
  );

  // Step 1: Parse the selected CSV files; the effect below advances to step 2
  const handleLoadData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      setLoadingMessage("Parsing CSV files...");
      await parseMultipleCsvFiles(selectedFiles);
    } catch (error) {
      debug.error("Error loading data:", error);
      if (!isMountedRef.current) return;
      const errorMessage = error instanceof Error ? error.message : "Failed to load data";
      setIsLoadingData(false);
      setLoadingMessage(`Error: ${errorMessage}`);
    }
  }, [selectedFiles, parseMultipleCsvFiles]);

  // Rows passed in skip step 1. Waits for accounts so step 2 finds the existing ones.
  const initialHandledRef = useRef(false);
  useEffect(() => {
    if (!initial || !accountsLoaded || initialHandledRef.current) return;
    initialHandledRef.current = true;
    setParsedData(initial.rows);
    processDataToStep2(initial.rows);
  }, [initial, accountsLoaded, processDataToStep2]);

  // Process manual CSV data when it's ready
  useEffect(() => {
    if (manualParsedData && manualParsedData.length > 0 && currentStep === 1 && !isParsing) {
      setParsedData(manualParsedData);
      processDataToStep2(manualParsedData);
    }
  }, [manualParsedData, isParsing, currentStep, processDataToStep2]);

  // Step 2: Update account preview (memoized to prevent child re-renders)
  const handleAccountPreviewChange = useCallback((index: number, name: string) => {
    setAccountPreviews((prevPreviews) => {
      const newPreviews = [...prevPreviews];
      newPreviews[index].name = name;
      return newPreviews;
    });
  }, []);

  // Steps 2-5 of import preparation for the rows of one IBKR account.
  // Returns null on a fatal processing error; warnings are pushed to `errors`.
  const prepareTransactionGroups = async (
    rows: CsvRowData[],
    previews: AccountPreview[],
    errors: string[],
  ): Promise<TransactionGroup[] | null> => {
    let activitiesWithFX: ActivityImport[] = [];
    // 2. Process data, resolve tickers, convert to activities
    try {
      const processResult = await processAndResolveData(
        rows,
        previews,
        ctx?.api?.market?.searchTicker,
        (current, total) => {
          if (isMountedRef.current) setResolutionProgress({ current, total });
        },
      );
      // Check if still mounted after async operation
      if (!isMountedRef.current) return [];
      activitiesWithFX = processResult.activities;

      // Log conversion errors for user visibility
      if (processResult.conversionErrors.length > 0) {
        const errorSummary = `${processResult.conversionErrors.length} transaction(s) failed to convert`;
        debug.warn(errorSummary, processResult.conversionErrors);
        errors.push(errorSummary);
      }
      if (processResult.skippedCount > 0) {
        debug.log(`Skipped ${processResult.skippedCount} unrecognized transaction types`);
      }
      // Warn user about skipped FX conversions (missing accounts, invalid format, etc.)
      if (processResult.skippedFXConversions.length > 0) {
        const fxSummary = `${processResult.skippedFXConversions.length} FX conversion(s) skipped`;
        debug.warn(fxSummary, processResult.skippedFXConversions);
        errors.push(fxSummary);
      }
    } catch (error) {
      if (!isMountedRef.current) return [];
      const msg = `Failed to process transactions: ${getErrorMessage(error)}`;
      debug.error(msg);
      errors.push(msg);
      return null;
    }

    // 3. Fetch existing activities for deduplication
    let existingActivities: import("../types").ActivityFingerprint[] = [];
    try {
      const fetchResult = await fetchExistingActivitiesForDedup(ctx?.api?.activities, previews);
      // Check if still mounted after async operation
      if (!isMountedRef.current) return [];
      existingActivities = fetchResult.activities;
      if (!fetchResult.complete) {
        const msg = `Could not load activities from ${fetchResult.failedAccounts.length} account(s): ${fetchResult.failedAccounts.join(", ")}. Duplicates may occur for these accounts.`;
        debug.warn(msg);
        errors.push(msg);
      }
    } catch (error) {
      if (!isMountedRef.current) return [];
      const msg = `Failed to fetch existing activities for deduplication: ${getErrorMessage(error)}`;
      debug.warn(msg);
      errors.push(msg);
      // Continue without deduplication - non-fatal but may create duplicates
    }

    // 4. Deduplicate activities
    let dedupedActivities = activitiesWithFX;
    try {
      dedupedActivities = deduplicateActivities(activitiesWithFX, existingActivities);
    } catch (error) {
      const msg = `Deduplication failed, proceeding without: ${getErrorMessage(error)}`;
      debug.warn(msg);
      errors.push(msg);
      // Continue with original activities - non-fatal but may create duplicates
    }

    // 5. Group by currency and create transaction groups
    let groupedByCurrency: Map<string, ActivityImport[]>;
    try {
      groupedByCurrency = groupActivitiesByCurrency(dedupedActivities);
    } catch (error) {
      const msg = `Failed to group transactions: ${getErrorMessage(error)}`;
      debug.error(msg);
      errors.push(msg);
      return [];
    }

    // 6. Drop rows the host already has. New accounts have nothing stored yet.
    const duplicatesByCurrency = new Map<string, number>();
    for (const preview of previews) {
      const rows = groupedByCurrency.get(preview.currency);
      const activitiesApi = ctx?.api?.activities;
      if (!activitiesApi || !preview.existingAccount || !rows?.length) continue;
      const accountId = preview.existingAccount.id;
      try {
        const { toImport, duplicates } = await dropHostDuplicates(
          activitiesApi,
          rows.map((a) => ({ ...a, accountId })),
        );
        if (!isMountedRef.current) return [];
        groupedByCurrency.set(preview.currency, toImport);
        duplicatesByCurrency.set(preview.currency, duplicates);
      } catch (error) {
        const msg = `Duplicate check failed for ${preview.name}: ${getErrorMessage(error)}`;
        debug.warn(msg);
        errors.push(msg);
      }
    }

    try {
      return createTransactionGroups(previews, groupedByCurrency).map((g) => ({
        ...g,
        duplicates: duplicatesByCurrency.get(g.currency) ?? 0,
      }));
    } catch (error) {
      const msg = `Failed to group transactions: ${getErrorMessage(error)}`;
      debug.error(msg);
      errors.push(msg);
    }

    return [];
  };

  // Step 2 → Step 3: Process and resolve tickers
  const handleProceedToStep3 = async () => {
    setIsResolving(true);
    setCurrentStep(3);

    const errors: string[] = [];
    let updatedPreviews = accountPreviews;

    // 1. Refresh accounts and update previews
    try {
      const result = await refreshAndUpdateAccountPreviews(
        ctx?.api?.accounts,
        accountPreviews,
        accounts,
      );
      // Check if still mounted after async operation
      if (!isMountedRef.current) return;
      setAccounts(result.freshAccounts);
      updatedPreviews = result.updatedPreviews;
      setAccountPreviews(updatedPreviews);
    } catch (error) {
      if (!isMountedRef.current) return;
      const msg = `Failed to refresh accounts: ${getErrorMessage(error)}`;
      debug.error(msg);
      errors.push(msg);
      // Continue with existing accounts - non-fatal
    }

    // 2-5. Process each IBKR account separately: FX conversions, dedup and
    // grouping are scoped to the Wealthfolio accounts of that IBKR account.
    const allGroups: TransactionGroup[] = [];
    for (const partition of partitionByIbkrAccount(parsedData)) {
      const partitionPreviews = updatedPreviews.filter(
        (p) => (p.ibkrAccount ?? "") === partition.ibkrAccount,
      );
      const groups = await prepareTransactionGroups(partition.rows, partitionPreviews, errors);
      if (groups === null) {
        // Fatal processing error - cannot continue without activities
        setResolutionProgress(undefined);
        setIsResolving(false);
        return;
      }
      if (!isMountedRef.current) return;
      allGroups.push(...groups);
    }
    setTransactionGroups(allGroups);

    // Log any accumulated warnings
    if (errors.length > 0) {
      debug.warn(`Import preparation completed with ${errors.length} warning(s):`, errors);
    }

    setResolutionProgress(undefined);
    setIsResolving(false);
  };

  // Step 3 → Step 4: Import transactions
  const handleStartImport = async () => {
    if (!ctx?.api) {
      debug.error("No ctx.api available - cannot import!");
      return;
    }

    setIsImporting(true);
    setCurrentStep(4);

    const results: ImportResult[] = [];
    let currentProgress = 0;
    const totalSteps = accountPreviews.length + transactionGroups.length;

    // Track created/existing accounts per IBKR account and currency
    // (avoid mutating state directly)
    const accountKey = (ibkrAccount: string | undefined, currency: string) =>
      `${ibkrAccount ?? ""}|${currency}`;
    const accountsByKey = new Map<string, Account>();

    // Initialize with existing accounts from previews
    for (const preview of accountPreviews) {
      if (preview.existingAccount) {
        accountsByKey.set(
          accountKey(preview.ibkrAccount, preview.currency),
          preview.existingAccount,
        );
      }
    }

    try {
      // Create accounts that don't exist yet
      for (const preview of accountPreviews) {
        // Check if still mounted before each iteration
        if (!isMountedRef.current) return;

        if (!preview.existingAccount) {
          setImportProgress({
            current: ++currentProgress,
            total: totalSteps,
            message: `Creating account: ${preview.name}`,
          });

          try {
            const newAccount = await ctx.api.accounts.create({
              name: preview.name,
              currency: preview.currency,
              group: preview.group,
              accountNumber: preview.ibkrAccount,
              accountType: "SECURITIES",
              trackingMode: "TRANSACTIONS",
              isDefault: false,
              isActive: true,
            });
            // Track in local map instead of mutating state
            accountsByKey.set(accountKey(preview.ibkrAccount, preview.currency), newAccount);
          } catch (error) {
            debug.error(`Failed to create account ${preview.name}:`, error);
          }
        } else {
          currentProgress++;
        }
      }

      // Pre-create any additional accounts needed for transaction currencies
      // This prevents race conditions during the import phase
      const accountsNeeded = new Map<
        string,
        { ibkrAccount?: string; ibkrLabel?: string; currency: string }
      >();
      for (const group of transactionGroups) {
        for (const txn of group.transactions) {
          const currency = txn.currency || group.currency;
          accountsNeeded.set(accountKey(group.ibkrAccount, currency), {
            ibkrAccount: group.ibkrAccount,
            ibkrLabel: group.ibkrLabel,
            currency,
          });
        }
      }

      // Create any missing accounts before starting imports
      for (const [key, { ibkrAccount, ibkrLabel, currency }] of accountsNeeded) {
        if (!isMountedRef.current) return;
        if (!accountsByKey.has(key)) {
          try {
            const newAccountName = `${accountNamePrefix(groupName, ibkrLabel)} - ${currency}`;
            const newAccount = await ctx.api.accounts.create({
              name: newAccountName,
              currency: currency,
              group: groupName,
              accountNumber: ibkrAccount,
              accountType: "SECURITIES",
              trackingMode: "TRANSACTIONS",
              isDefault: false,
              isActive: true,
            });
            accountsByKey.set(key, newAccount);
            debug.log(`Pre-created account for currency: ${currency}`);
          } catch (error) {
            debug.error(`Failed to pre-create account for ${currency}:`, error);
            // Continue - will fail during import if account truly doesn't exist
          }
        }
      }

      // Import transactions (all accounts should now exist)
      for (const group of transactionGroups) {
        // Check if still mounted before each iteration
        if (!isMountedRef.current) return;

        setImportProgress({
          current: ++currentProgress,
          total: totalSteps,
          message: `Importing ${group.transactions.length} transactions to ${group.accountName}`,
        });

        // Track totals for this group (including partial success)
        let groupTotalImported = 0;
        let groupTotalFailed = 0;
        let groupTotalSkipped = 0;
        const groupErrors: string[] = [];

        try {
          // Group transactions by their actual currency
          const transactionsByCurrency = new Map<string, ActivityImport[]>();
          for (const txn of group.transactions) {
            const txnCurrency = txn.currency || group.currency;
            let currencyGroup = transactionsByCurrency.get(txnCurrency);
            if (!currencyGroup) {
              currencyGroup = [];
              transactionsByCurrency.set(txnCurrency, currencyGroup);
            }
            currencyGroup.push(txn);
          }

          // Import transactions grouped by their actual currency
          for (const [txnCurrency, transactions] of transactionsByCurrency) {
            const targetAccount = accountsByKey.get(accountKey(group.ibkrAccount, txnCurrency));

            if (!targetAccount) {
              // Account creation failed earlier - skip these transactions
              groupTotalFailed += transactions.length;
              groupErrors.push(`No account available for currency ${txnCurrency}`);
              continue;
            }

            // Set accountId on each transaction and import directly
            // (deduplication already happened in Step 3)
            const accountId = targetAccount.id;
            const transactionsWithAccountId = transactions.map((txn) => ({
              ...txn,
              accountId,
            }));

            if (transactionsWithAccountId.length > 0) {
              try {
                const outcome = await importValidated(
                  ctx.api.activities,
                  transactionsWithAccountId,
                );
                groupTotalImported += outcome.imported;
                groupTotalFailed += outcome.failed;
                groupTotalSkipped += outcome.duplicates;
                groupErrors.push(...outcome.errors);
              } catch (importError) {
                groupTotalFailed += transactionsWithAccountId.length;
                groupErrors.push(
                  `Import failed for ${txnCurrency}: ${getErrorMessage(importError)}`,
                );
              }
            }
          }

          results.push({
            accountId: accountsByKey.get(accountKey(group.ibkrAccount, group.currency))?.id || "",
            accountName: group.accountName,
            currency: group.currency,
            success: groupTotalImported,
            failed: groupTotalFailed,
            skipped: groupTotalSkipped,
            errors: groupErrors,
          });
        } catch (error) {
          const errorMessage = getErrorMessage(error);

          results.push({
            accountId: accountsByKey.get(accountKey(group.ibkrAccount, group.currency))?.id || "",
            accountName: group.accountName,
            currency: group.currency,
            success: groupTotalImported, // Reflect partial success
            failed: group.transactions.length - groupTotalImported,
            skipped: groupTotalSkipped,
            errors: [...groupErrors, errorMessage],
          });
        }
      }

      // Check if still mounted before final state updates
      if (!isMountedRef.current) return;
      setImportResults(results);
      setImportProgress(undefined);
      setIsImporting(false);
    } catch (error) {
      debug.error("Import failed:", error);
      if (!isMountedRef.current) return;
      setImportProgress(undefined);
      setIsImporting(false);
    }
  };

  // Navigation (memoized to prevent child re-renders)
  const goToPreviousStep = useCallback(() => {
    setCurrentStep((prev) => (prev > 1 ? prev - 1 : prev));
  }, []);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        if (initial) return null;
        return (
          <IBKRSourceSelectionStep
            accountGroup={{
              groupName,
              setGroupName,
              existingGroups,
            }}
            csvFiles={{
              files: selectedFiles,
              setFiles: setSelectedFiles,
            }}
            isLoading={isLoadingData || isParsing}
            onNext={handleLoadData}
          />
        );
      case 2:
        return (
          <IBKRCurrencyPreviewStep
            accountPreviews={accountPreviews}
            onAccountPreviewChange={handleAccountPreviewChange}
            onBack={initial ? () => onClose(null) : goToPreviousStep}
            onNext={handleProceedToStep3}
          />
        );
      case 3:
        return (
          <IBKRTickerPreviewStep
            isResolving={isResolving}
            resolutionProgress={resolutionProgress}
            transactionGroups={transactionGroups}
            onBack={goToPreviousStep}
            onNext={handleStartImport}
          />
        );
      case 4:
        return (
          <IBKRImportResultsStep
            isImporting={isImporting}
            importProgress={importProgress}
            results={importResults}
            onDone={() =>
              onClose({
                imported: importResults.reduce((sum, r) => sum + r.success, 0),
                failed: importResults.reduce((sum, r) => sum + r.failed, 0),
              })
            }
          />
        );
      default:
        return null;
    }
  };

  return (
    <Card className="w-full">
      <div className="border-b px-3 py-3 sm:px-6 sm:py-4">
        <StepIndicator steps={STEPS} currentStep={currentStep} />
      </div>
      <div className="p-3 sm:p-6">
        {loadingMessage && currentStep === 1 && (
          <div className="mb-4 p-3 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm">
            {loadingMessage}
          </div>
        )}
        {parsingErrors.length > 0 && currentStep === 1 && (
          <div className="mb-4 p-3 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-sm">
            {parsingErrors.map((err, i) => (
              <div key={i}>{err.message}</div>
            ))}
          </div>
        )}
        {renderStep()}
      </div>
    </Card>
  );
};

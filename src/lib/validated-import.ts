import type { ActivityImport, ImportActivitiesResult } from "@wealthfolio/addon-sdk";

export interface ValidatedImportResult {
  imported: number;
  duplicates: number;
  /** Rows the host rejected during validation or import */
  failed: number;
  /** Distinct "field: message" errors reported by the host */
  errors: string[];
}

interface ImportApi {
  checkImport(activities: ActivityImport[]): Promise<ActivityImport[]>;
  import(activities: ActivityImport[]): Promise<ImportActivitiesResult>;
}

/**
 * Rows the host does not already have. `checkImport` flags a stored match with
 * `duplicateOfId` and a repeat within `activities` with `duplicateOfLineNumber`.
 * Rows must already carry `accountId`: the host matches per account.
 */
export async function dropHostDuplicates(
  api: Pick<ImportApi, "checkImport">,
  activities: ActivityImport[],
): Promise<{ toImport: ActivityImport[]; duplicates: number }> {
  if (activities.length === 0) return { toImport: [], duplicates: 0 };
  const checked = await api.checkImport(activities);
  const toImport = activities.filter(
    (_, i) => !checked[i]?.duplicateOfId && checked[i]?.duplicateOfLineNumber == null,
  );
  return { toImport, duplicates: activities.length - toImport.length };
}

function collectErrors(rows: ActivityImport[], into: Set<string>): void {
  for (const row of rows) {
    for (const [field, messages] of Object.entries(row.errors ?? {})) {
      for (const message of messages) into.add(`${row.symbol ?? ""} ${field}: ${message}`.trim());
    }
  }
}

/**
 * Import through the host's two-step flow. checkImport resolves assets
 * (assetId / quoteCcy / instrumentType), which import requires for every
 * asset-backed row; the host rejects the whole batch if any row is invalid,
 * so only rows that passed validation are sent.
 */
export async function importValidated(
  api: ImportApi,
  activities: ActivityImport[],
): Promise<ValidatedImportResult> {
  if (activities.length === 0) return { imported: 0, duplicates: 0, failed: 0, errors: [] };

  const checked = await api.checkImport(activities);
  const errors = new Set<string>();
  const invalid = checked.filter(
    (a) => a.isValid === false || Object.keys(a.errors ?? {}).length > 0,
  );
  const valid = checked.filter((a) => !invalid.includes(a));
  collectErrors(invalid, errors);

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, failed: invalid.length, errors: [...errors] };
  }

  const result = await api.import(valid);
  const { summary } = result;
  if (!summary.success) collectErrors(result.activities ?? [], errors);
  return {
    imported: summary.imported,
    duplicates: summary.duplicates,
    failed: invalid.length + (summary.success ? 0 : valid.length - summary.imported),
    errors: [...errors],
  };
}

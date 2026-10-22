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
export async function importValidated(api: ImportApi, activities: ActivityImport[]): Promise<ValidatedImportResult> {
  if (activities.length === 0) return { imported: 0, duplicates: 0, failed: 0, errors: [] };

  const checked = await api.checkImport(activities);
  const errors = new Set<string>();
  const invalid = checked.filter((a) => a.isValid === false || Object.keys(a.errors ?? {}).length > 0);
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

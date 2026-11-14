import React from "react";
import { Input, Label, Button } from "@wealthfolio/ui";
import { Loader2 } from "lucide-react";
import { MultiFileDropzone } from "./multi-file-dropzone";
import { AccountGroupSuggestions } from "./account-group-suggestions";

/** Grouped props for account group configuration */
export interface AccountGroupConfig {
  groupName: string;
  setGroupName: (name: string) => void;
  existingGroups: string[];
}

/** Grouped props for CSV file selection */
export interface CsvFilesConfig {
  files: File[];
  setFiles: (files: File[]) => void;
}

interface IBKRSourceSelectionStepProps {
  /** Account group configuration */
  accountGroup: AccountGroupConfig;
  /** CSV file selection */
  csvFiles: CsvFilesConfig;
  /** Loading state */
  isLoading: boolean;
  /** Proceed to next step */
  onNext: () => void;
}

export const IBKRSourceSelectionStep: React.FC<IBKRSourceSelectionStepProps> = ({
  accountGroup,
  csvFiles,
  isLoading,
  onNext,
}) => {
  // Destructure grouped props for convenience
  const { groupName, setGroupName, existingGroups } = accountGroup;
  const { files: selectedFiles, setFiles: setSelectedFiles } = csvFiles;
  const hasGroupName = groupName.trim().length > 0;
  const hasFiles = selectedFiles.length > 0;
  const canProceed = hasGroupName && hasFiles;

  const missingRequirements = [
    !hasGroupName && "Account group name",
    !hasFiles && "CSV files",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Account Group Selection */}
      <div className="space-y-3">
        <Label className="text-base font-medium">
          Account Group <span className="text-destructive">*</span>
        </Label>
        <p className="text-sm text-muted-foreground">
          Enter a name for the account group. Accounts will be created as "
          {groupName || "GroupName"} - USD", "{groupName || "GroupName"} - EUR", etc.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="e.g., IBKR Main, IBKR ISA"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="flex-1"
            list="existing-groups"
          />
          {existingGroups.length > 0 && (
            <datalist id="existing-groups">
              {existingGroups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          )}
        </div>

        <AccountGroupSuggestions
          groups={existingGroups}
          currentValue={groupName}
          onSelect={setGroupName}
        />
      </div>

      {/* CSV Upload */}
      <div className="space-y-3">
        <MultiFileDropzone files={selectedFiles} onFilesChange={setSelectedFiles} accept=".csv" />
        <p className="text-xs text-muted-foreground">
          Export Activity Statements from IBKR Client Portal as CSV files
        </p>
      </div>

      {/* Next Button */}
      <div className="flex flex-col items-end gap-2 pt-4">
        {!canProceed && !isLoading && (
          <p className="text-xs text-muted-foreground">
            Required: {missingRequirements.join(", ")}
          </p>
        )}
        <Button onClick={onNext} disabled={!canProceed || isLoading} size="lg">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>Parse Files</>
          )}
        </Button>
      </div>
    </div>
  );
};

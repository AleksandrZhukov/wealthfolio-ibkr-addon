import React from "react";
import { Button, Badge } from "@wealthfolio/ui";
import { Pencil, Trash2, Clock, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import type { FlexQueryConfig } from "../lib/flex-config-storage";

interface FlexConfigItemProps {
  config: FlexQueryConfig;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  /** `message` is the live progress line while running, then the result. */
  syncState?: { running: boolean; message?: string };
}

// Helper to format relative time
const formatRelativeTime = (isoString: string): string => {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

export const FlexConfigItem: React.FC<FlexConfigItemProps> = ({
  config,
  onEdit,
  onDelete,
  onSync,
  syncState,
}) => {
  const running = syncState?.running ?? false;
  return (
    <div className="flex items-center justify-between p-4 hover:bg-muted/50">
      <div className="space-y-1">
        {/* Name and badges */}
        <div className="flex items-center gap-2">
          <span className="font-medium">{config.name}</span>
          {config.autoFetchEnabled ? (
            <Badge variant="secondary" className="text-xs">
              <RefreshCw className="mr-1 h-3 w-3" />
              Auto
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Manual
            </Badge>
          )}
        </div>

        {/* Details */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            Query ID: <code className="rounded bg-muted px-1">{config.queryId}</code>
          </span>
          <span>→</span>
          <span>
            Account Group: <strong>{config.accountGroup}</strong>
          </span>
        </div>

        <div className="text-xs text-muted-foreground">
          {config.syncedThrough
            ? `Synced through ${config.syncedThrough}`
            : `Not synced yet · first sync from ${config.historyFrom ?? "the query's Period"}`}
        </div>

        {/* Last fetch status */}
        {config.lastFetchTime && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Last fetch: {formatRelativeTime(config.lastFetchTime)}</span>
            {config.lastFetchStatus === "success" && (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            )}
            {config.lastFetchStatus === "error" && (
              <>
                <XCircle className="h-3 w-3 text-red-500" />
                {config.lastFetchError && (
                  <span className="text-red-500">({config.lastFetchError})</span>
                )}
              </>
            )}
          </div>
        )}

        {syncState?.message && <div className="text-xs">{syncState.message}</div>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSync} disabled={running}>
          <RefreshCw className={`mr-2 h-4 w-4${running ? " animate-spin" : ""}`} />
          Sync now
        </Button>
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
};

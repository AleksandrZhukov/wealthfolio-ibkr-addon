import React, { useState, useEffect } from "react";
import {
  Page,
  PageHeader,
  PageContent,
  Button,
  Input,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  EmptyPlaceholder,
  Skeleton,
} from "@wealthfolio/ui";
import { Plus, Eye, EyeOff, Loader2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AddonContext, Account } from "@wealthfolio/addon-sdk";
import { FlexConfigItem } from "../components/flex-config-item";
import { FlexConfigModal } from "../components/flex-config-modal";
import { ImportWizard } from "../components/import-wizard";
import {
  connectionUpdates,
  type ConnectionFormData,
  type FlexQueryConfig,
} from "../lib/flex-config-storage";
import {
  QUERY_KEYS,
  useFlexConfigs,
  useFlexToken,
  useAddConfig,
  useUpdateConfig,
  useDeleteConfig,
  useSaveToken,
} from "../hooks/use-flex-configs";
import { syncNow } from "../lib/auto-fetch-processor";
import { formatImportResultMessage } from "../lib/auto-fetch-helpers";
import { getOrCreateAccountsForGroup } from "../lib/ibkr-accounts";
import { getErrorMessage } from "../lib/shared-utils";

type SyncState = { running: boolean; message?: string };

/** One page for the Flex token, the connections, and the CSV wizard. */
export const IBKRPage: React.FC<{ ctx: AddonContext }> = ({ ctx }) => {
  const secrets = ctx.api.secrets;
  const queryClient = useQueryClient();

  const [view, setView] = useState<"connections" | "wizard">("connections");
  const [syncState, setSyncState] = useState<Record<string, SyncState>>({});

  // Token state
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenDirty, setTokenDirty] = useState(false);
  const [editingToken, setEditingToken] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FlexQueryConfig | undefined>();

  // Delete confirmation state
  const [deleteConfig, setDeleteConfig] = useState<FlexQueryConfig | null>(null);

  // Account groups (for dropdown suggestions)
  const [existingGroups, setExistingGroups] = useState<string[]>([]);

  // Queries
  const { data: configs, isLoading: configsLoading } = useFlexConfigs(secrets);
  const { data: savedToken, isLoading: tokenLoading } = useFlexToken(secrets);

  // Mutations
  const addConfigMutation = useAddConfig(secrets);
  const updateConfigMutation = useUpdateConfig(secrets);
  const deleteConfigMutation = useDeleteConfig(secrets);
  const saveTokenMutation = useSaveToken(secrets);

  // Load accounts to get existing groups. Depend on `ctx`, not `ctx.api.accounts`:
  // the sandbox returns a fresh proxy on every property access, which would
  // re-run this effect after each render and loop forever.
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const accounts: Account[] = await ctx.api.accounts.getAll();
        const groups = [...new Set(accounts.map((a) => a.group).filter(Boolean))] as string[];
        setExistingGroups(groups.sort());
      } catch (e) {
        ctx.api.logger.error(`Failed to load accounts: ${getErrorMessage(e)}`);
      }
    };
    loadAccounts();
  }, [ctx]);

  // Sync token input with saved token
  useEffect(() => {
    if (savedToken !== undefined && savedToken !== null && !tokenDirty) {
      setTokenInput(savedToken);
    }
  }, [savedToken, tokenDirty]);

  const handleTokenChange = (value: string) => {
    setTokenInput(value);
    setTokenDirty(true);
  };

  const handleSaveToken = async () => {
    await saveTokenMutation.mutateAsync(tokenInput);
    setTokenDirty(false);
    setEditingToken(false);
  };

  const handleAddConfig = () => {
    setEditingConfig(undefined);
    setModalOpen(true);
  };

  const handleEditConfig = (config: FlexQueryConfig) => {
    setEditingConfig(config);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (deleteConfig) {
      await deleteConfigMutation.mutateAsync(deleteConfig.id);
      setDeleteConfig(null);
    }
  };

  const handleSubmitConfig = async (data: ConnectionFormData) => {
    if (editingConfig) {
      await updateConfigMutation.mutateAsync({
        id: editingConfig.id,
        updates: connectionUpdates(editingConfig, data),
      });
    } else {
      await addConfigMutation.mutateAsync(connectionUpdates(undefined, data));
    }
  };

  const setConfigSync = (id: string, state: SyncState) =>
    setSyncState((prev) => ({ ...prev, [id]: state }));

  const handleSync = async (config: FlexQueryConfig) => {
    if (!savedToken) {
      toast.error("Save your Flex token first");
      return;
    }
    setConfigSync(config.id, { running: true });
    const result = await syncNow(config, {
      ctx,
      token: savedToken,
      getOrCreateAccountsForGroup: (g, c, i) => getOrCreateAccountsForGroup(ctx.api, g, c, i),
      onProgress: (message) => setConfigSync(config.id, { running: true, message }),
    });
    if (result === "busy") {
      toast.info("A sync is already running");
      setConfigSync(config.id, { running: false });
      return;
    }
    setConfigSync(config.id, {
      running: false,
      message: result.success
        ? formatImportResultMessage(result.imported, result.skipped, result.failed)
        : result.error,
    });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.configs });
  };

  const closeWizard = () => {
    setView("connections");
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.configs });
  };

  const isSubmitting = addConfigMutation.isPending || updateConfigMutation.isPending;
  const showTokenForm = !savedToken || editingToken;

  return (
    <Page>
      <PageHeader
        heading="IBKR"
        actions={
          view === "connections" ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setView("wizard")}>
                <Upload className="mr-2 h-4 w-4" />
                Import CSV
              </Button>
              <Button onClick={handleAddConfig}>
                <Plus className="mr-2 h-4 w-4" />
                Add connection
              </Button>
            </div>
          ) : undefined
        }
      />

      <PageContent>
        {view === "wizard" ? (
          <div className="space-y-4">
            <Button variant="ghost" onClick={closeWizard}>
              ← Connections
            </Button>
            <ImportWizard ctx={ctx} onClose={closeWizard} />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Token Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Flex Token</CardTitle>
                <CardDescription>
                  Your IBKR Flex Web Service token. This is shared across all connections.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {tokenLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : !showTokenForm ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Flex token saved</span>
                    <Button variant="outline" onClick={() => setEditingToken(true)}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showToken ? "text" : "password"}
                          value={tokenInput}
                          onChange={(e) => handleTokenChange(e.target.value)}
                          placeholder="Enter your Flex Web Service token"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken(!showToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        onClick={handleSaveToken}
                        disabled={!tokenDirty || saveTokenMutation.isPending}
                      >
                        {saveTokenMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Get this from IBKR Client Portal → Reporting → Flex Queries → Flex Web Service
                      Configuration
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Connections */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Connections</h3>

              {configsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : configs && configs.length > 0 ? (
                <div className="divide-y rounded-md border">
                  {configs.map((config) => (
                    <FlexConfigItem
                      key={config.id}
                      config={config}
                      onEdit={() => handleEditConfig(config)}
                      onDelete={() => setDeleteConfig(config)}
                      onSync={() => void handleSync(config)}
                      syncState={syncState[config.id]}
                    />
                  ))}
                </div>
              ) : (
                <EmptyPlaceholder>
                  <EmptyPlaceholder.Icon name="Settings" />
                  <EmptyPlaceholder.Title>No connections yet</EmptyPlaceholder.Title>
                  <EmptyPlaceholder.Description>
                    Add a Flex Query to sync IBKR transactions into an account group.
                  </EmptyPlaceholder.Description>
                  <Button onClick={handleAddConfig}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add connection
                  </Button>
                </EmptyPlaceholder>
              )}
            </div>
          </div>
        )}
      </PageContent>

      {/* Add/Edit Modal */}
      <FlexConfigModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        config={editingConfig}
        existingGroups={existingGroups}
        onSubmit={handleSubmitConfig}
        isSubmitting={isSubmitting}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfig} onOpenChange={() => setDeleteConfig(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfig?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConfigMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
};

export default IBKRPage;

"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { MappingConfirmPanel } from "@/components/data/mapping-confirm";
import { ReimportForm } from "@/components/data/reimport-form";
import { ImportStatus } from "@/components/data/import-status";
import { VersionList } from "@/components/data/version-list";
import { api } from "@/lib/api-client";
import type { DatasetDTO, DatasetDetailDTO, DatasetVersionDTO } from "@/lib/types";
import { useState } from "react";

export default function DatasetsPage() {
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [showReimport, setShowReimport] = useState(false);
  const [syncJobIds, setSyncJobIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSelectDataset = (id: string) => {
    setSelectedDataset(id);
    setShowReimport(false);
    setSyncJobIds([]);
    setSyncError(null);
  };

  const handleSyncFromSource = async (dataSourceId: string) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api.dataSources.sync(dataSourceId);
      setSyncJobIds(result.importJobs.map((job) => job.id));
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const {
    data: datasetsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api.get<{ datasets: DatasetDTO[] }>("/datasets"),
  });

  const {
    data: detailData,
    isLoading: detailLoading,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ["dataset", selectedDataset],
    queryFn: () => api.get<DatasetDetailDTO>(`/datasets/${selectedDataset}`),
    enabled: !!selectedDataset,
  });

  const { data: versionsData, refetch: refetchVersions } = useQuery({
    queryKey: ["dataset-versions", selectedDataset],
    queryFn: () =>
      api.get<{ versions: DatasetVersionDTO[] }>(
        `/datasets/${selectedDataset}/versions`,
      ),
    enabled: !!selectedDataset,
  });

  if (isLoading) {
    return <Loading label="Loading datasets..." />;
  }

  if (error) {
    return (
      <ErrorState
        message={(error as Error).message}
        onRetry={() => refetch()}
      />
    );
  }

  const datasets = datasetsData?.datasets ?? [];

  const getStatusConfig = (status: DatasetDTO["status"]) => {
    switch (status) {
      case "DRAFT":
        return { icon: AlertCircle, color: "text-muted-foreground", label: "Draft" };
      case "READY":
        return { icon: CheckCircle, color: "text-[#4ADE80]", label: "Ready" };
      case "READY_WITH_WARNINGS":
        return { icon: AlertCircle, color: "text-[#FDE047]", label: "Ready (Warnings)" };
      case "ERROR":
        return { icon: AlertCircle, color: "text-[#F87171]", label: "Error" };
    }
  };

  if (datasets.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Datasets</h1>
          <p className="text-muted-foreground mt-1">View and manage your imported datasets</p>
        </div>
        <EmptyState
          icon={<Database />}
          title="No datasets yet"
          description="Upload files from Data Sources to create datasets"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Datasets</h1>
        <p className="text-muted-foreground mt-1">
          {datasets.length} {datasets.length === 1 ? "dataset" : "datasets"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-3">
          {datasets.map((dataset) => {
            const statusConfig = getStatusConfig(dataset.status);
            const StatusIcon = statusConfig.icon;

            return (
              <Card
                key={dataset.id}
                className={`p-4 cursor-pointer transition-all ${
                  selectedDataset === dataset.id
                    ? "ring-2 ring-primary shadow-md"
                    : "hover:shadow-md"
                }`}
                onClick={() => handleSelectDataset(dataset.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{dataset.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {dataset.kind === "CUSTOM" ? "Custom Data" : dataset.kind}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
                    <span className={`text-xs font-medium ${statusConfig.color}`}>
                      {statusConfig.label}
                    </span>
                  </div>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {dataset.rowCount.toLocaleString()} rows
                </div>
              </Card>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          {selectedDataset ? (
            detailLoading ? (
              <Card className="p-6">
                <Loading label="Loading dataset details..." />
              </Card>
            ) : detailData ? (
              <Card className="p-6">
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-semibold">{detailData.name}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="text-muted-foreground">
                        Status: <span className="font-medium">{detailData.status}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Source:{" "}
                        <span className="font-medium">
                          {detailData.source === "TABLE_SYNC" ? "Table sync" : "Upload"}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        Rows: <span className="font-medium">{detailData.rowCount.toLocaleString()}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Columns: <span className="font-medium">{detailData.columns.length}</span>
                      </span>
                    </div>
                  </div>

                  {detailData.pendingMappings.length > 0 ||
                  detailData.status === "DRAFT" ? (
                    <MappingConfirmPanel
                      dataset={detailData}
                      onConfirmed={() => refetchDetail()}
                    />
                  ) : null}

                  {detailData.source === "TABLE_SYNC" && detailData.dataSourceId ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">Sync from source</h3>
                        <Button
                          onClick={() => handleSyncFromSource(detailData.dataSourceId!)}
                          variant="outline"
                          disabled={syncing || syncJobIds.length > 0}
                        >
                          <RefreshCw
                            className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`}
                          />
                          {syncing
                            ? "Starting sync..."
                            : syncJobIds.length > 0
                              ? "Sync running..."
                              : "Sync from source"}
                        </Button>
                      </div>
                      {syncError && <p className="text-sm text-[#F87171] mb-2">{syncError}</p>}
                      {syncJobIds.length > 0 ? (
                        <div className="space-y-2">
                          {syncJobIds.map((importId) => (
                            <ImportStatus
                              key={importId}
                              importId={importId}
                              onComplete={() => {
                                refetchDetail();
                                refetchVersions();
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Pulls the current data from the external database and replaces this
                          dataset using the Replace/Upsert mode configured for the source table.
                          {detailData.lastSyncAt
                            ? ` Last synced ${new Date(detailData.lastSyncAt).toLocaleString()}.`
                            : ""}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">Re-import</h3>
                        <Button onClick={() => setShowReimport((shown) => !shown)} variant="outline">
                          {showReimport ? "Cancel" : "Re-import"}
                        </Button>
                      </div>
                      {showReimport ? (
                        <ReimportForm
                          datasetId={detailData.id}
                          columns={detailData.columns.map((column) => ({ name: column.name }))}
                          onReimportComplete={() => {
                            setShowReimport(false);
                            refetchDetail();
                            refetchVersions();
                          }}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Append, replace, or upsert rows from a new file, creating a new version.
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <h3 className="font-medium mb-3">Schema</h3>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-medium text-foreground/80">
                              Column
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-medium text-foreground/80">
                              Type
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-medium text-foreground/80">
                              Semantic Key
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {detailData.columns.map((column) => (
                            <tr key={column.id} className="hover:bg-muted">
                              <td className="px-4 py-2 text-sm font-medium">{column.name}</td>
                              <td className="px-4 py-2 text-sm text-muted-foreground">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[rgba(59,130,246,0.15)] text-[#60A5FA]">
                                  {column.type}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-muted-foreground">
                                {column.semanticKey ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[rgba(34,197,94,0.15)] text-[#4ADE80]">
                                    {column.semanticKey}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/70">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium mb-3">Version history</h3>
                    <VersionList
                      versions={versionsData?.versions ?? []}
                      currentVersionId={detailData.currentVersionId}
                    />
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Created {new Date(detailData.createdAt).toLocaleString()}
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-6">
                <p className="text-muted-foreground">Select a dataset to view details</p>
              </Card>
            )
          ) : (
            <Card className="p-6">
              <p className="text-muted-foreground">Select a dataset to view details</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

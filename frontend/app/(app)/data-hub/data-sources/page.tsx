"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { UploadForm } from "@/components/data/upload-form";
import { ExternalDbForm } from "@/components/data/external-db-form";
import { ImportStatus } from "@/components/data/import-status";
import { api } from "@/lib/api-client";
import type { DataSourceDTO, ImportJobDTO } from "@/lib/types";

type AddSourceKind = "FILE" | "EXTERNAL_DB";

export default function DataSourcesPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addKind, setAddKind] = useState<AddSourceKind>("FILE");
  const [recentImport, setRecentImport] = useState<ImportJobDTO | null>(null);

  const {
    data: dataSources,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["data-sources"],
    queryFn: () => api.get<{ dataSources: DataSourceDTO[] }>("/data-sources"),
  });

  const handleUploadComplete = (result: { dataSource: DataSourceDTO; import: ImportJobDTO }) => {
    setRecentImport(result.import);
    setShowAddForm(false);
    refetch();
  };

  const handleExternalDbConnected = () => {
    refetch();
  };

  const handleExternalDbSynced = () => {
    refetch();
  };

  if (isLoading) {
    return <Loading label="Loading data sources..." />;
  }

  if (error) {
    return (
      <ErrorState
        message={(error as Error).message}
        onRetry={() => refetch()}
      />
    );
  }

  const sources = dataSources?.dataSources ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Data Sources</h1>
          <p className="text-muted-foreground mt-1">
            Upload files or connect to external databases
          </p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-4 w-4 mr-2" />
          {showAddForm ? "Cancel" : "Add Data Source"}
        </Button>
      </div>

      {showAddForm && (
        <Card className="p-6">
          <div className="flex gap-2 mb-4">
            <Button
              variant={addKind === "FILE" ? "default" : "outline"}
              size="sm"
              onClick={() => setAddKind("FILE")}
            >
              Upload File
            </Button>
            <Button
              variant={addKind === "EXTERNAL_DB" ? "default" : "outline"}
              size="sm"
              onClick={() => setAddKind("EXTERNAL_DB")}
            >
              External Database
            </Button>
          </div>
          <h2 className="text-lg font-semibold mb-4">
            {addKind === "FILE" ? "Upload File" : "Connect External Database"}
          </h2>
          {addKind === "FILE" ? (
            <UploadForm onUploadComplete={handleUploadComplete} />
          ) : (
            <ExternalDbForm
              onConnected={handleExternalDbConnected}
              onSyncComplete={handleExternalDbSynced}
            />
          )}
        </Card>
      )}

      {recentImport && (
        <Card className="p-6 bg-[rgba(59,130,246,0.15)] border-[rgba(59,130,246,0.35)]">
          <h3 className="text-sm font-medium mb-2">Recent Upload</h3>
          <ImportStatus
            importId={recentImport.id}
            onComplete={() => {
              refetch();
              setTimeout(() => setRecentImport(null), 3000);
            }}
          />
        </Card>
      )}

      {sources.length === 0 && !showAddForm ? (
        <EmptyState
          icon={<Database />}
          title="No data sources yet"
          description="Upload a CSV or Excel file to get started with your data analysis"
          action={<Button onClick={() => setShowAddForm(true)}>Upload First File</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <Card key={source.id} className="p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[rgba(59,130,246,0.15)] rounded-lg">
                    <FileText className="h-5 w-5 text-[#60A5FA]" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{source.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {source.kind === "FILE" ? "File Upload" : "External Database"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={`font-medium ${
                      source.status === "NEW"
                        ? "text-foreground/80"
                        : source.status === "CONNECTED"
                          ? "text-[#4ADE80]"
                          : source.status === "FAILED"
                            ? "text-[#F87171]"
                            : "text-[#60A5FA]"
                    }`}
                  >
                    {source.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Imports</span>
                  <span className="font-medium">{source.importCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Datasets</span>
                  <span className="font-medium">{source.datasetCount}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Created {new Date(source.createdAt).toLocaleDateString()}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { api } from "@/lib/api-client";
import type { DataQualityReportDTO, DatasetDTO } from "@/lib/types";

export default function DataQualityPage() {
  const searchParams = useSearchParams();
  const datasetId = searchParams.get("datasetId");

  const {
    data: datasetsData,
    isLoading: datasetsLoading,
  } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api.get<{ datasets: DatasetDTO[] }>("/datasets"),
  });

  const {
    data: qualityData,
    isLoading: qualityLoading,
    error: qualityError,
    refetch: refetchQuality,
  } = useQuery({
    queryKey: ["quality", datasetId],
    queryFn: () => api.get<DataQualityReportDTO>(`/datasets/${datasetId}/quality`),
    enabled: !!datasetId,
  });

  if (datasetsLoading) {
    return <Loading label="Loading datasets..." />;
  }

  const datasets = datasetsData?.datasets ?? [];
  const selectedDataset = datasets.find((ds) => ds.id === datasetId);

  if (!datasetId || !selectedDataset) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Data Quality</h1>
          <p className="text-muted-foreground mt-1">Review data quality reports for your datasets</p>
        </div>
        <EmptyState
          icon={<AlertTriangle />}
          title="Select a dataset"
          description="Choose a dataset to view its quality report"
        />
        {datasets.length > 0 && (
          <Card className="p-6">
            <h3 className="font-medium mb-3">Available Datasets</h3>
            <div className="space-y-2">
              {datasets.map((ds) => (
                <a
                  key={ds.id}
                  href={`/data-hub/data-quality?datasetId=${ds.id}`}
                  className="block p-3 border rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="font-medium">{ds.name}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {ds.rowCount.toLocaleString()} rows · {ds.status}
                  </div>
                </a>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  if (qualityLoading) {
    return <Loading label="Loading quality report..." />;
  }

  if (qualityError) {
    return (
      <ErrorState
        message={(qualityError as Error).message}
        onRetry={() => refetchQuality()}
      />
    );
  }

  if (!qualityData) {
    return <EmptyState
          icon={<AlertTriangle />}
          title="No quality report available"
          description="Run a quality assessment on the selected dataset to see results here"
        />;
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "CLEAN":
        return {
          icon: CheckCircle,
          color: "text-[#4ADE80]",
          bg: "bg-[rgba(34,197,94,0.15)]",
          label: "Clean",
        };
      case "WARNINGS":
        return {
          icon: AlertTriangle,
          color: "text-[#FDE047]",
          bg: "bg-[rgba(250,204,21,0.14)]",
          label: "Has Warnings",
        };
      case "ERROR":
        return {
          icon: XCircle,
          color: "text-[#F87171]",
          bg: "bg-[rgba(239,68,68,0.15)]",
          label: "Has Errors",
        };
      default:
        return {
          icon: AlertTriangle,
          color: "text-muted-foreground",
          bg: "bg-muted",
          label: status,
        };
    }
  };

  const statusConfig = getStatusConfig(qualityData.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Data Quality Report</h1>
          <p className="text-muted-foreground mt-1">{selectedDataset.name}</p>
        </div>
        <Button onClick={() => refetchQuality()}>Refresh</Button>
      </div>

      <Card className={`p-6 ${statusConfig.bg} border-2`}>
        <div className="flex items-center gap-3">
          <StatusIcon className={`h-8 w-8 ${statusConfig.color}`} />
          <div>
            <h2 className="text-xl font-semibold">Overall Status: {statusConfig.label}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Report generated {new Date(qualityData.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Total Rows</div>
          <div className="text-2xl font-bold mt-1">
            {qualityData.totalRows.toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Columns</div>
          <div className="text-2xl font-bold mt-1">{qualityData.columnCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Missing Values</div>
          <div className="text-2xl font-bold mt-1">{qualityData.missingValuePct.toFixed(1)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Duplicate Rows</div>
          <div className="text-2xl font-bold mt-1">
            {qualityData.duplicateRowPct.toFixed(1)}%
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Invalid Numbers</div>
          <div className="text-2xl font-bold mt-1">
            {qualityData.invalidNumberPct.toFixed(1)}%
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Invalid Dates</div>
          <div className="text-2xl font-bold mt-1">{qualityData.invalidDatePct.toFixed(1)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Numeric Outliers</div>
          <div className="text-2xl font-bold mt-1">{qualityData.numericOutlierCount}</div>
        </Card>
      </div>

      {qualityData.warnings && qualityData.warnings.length > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Warnings & Issues</h3>
          <div className="space-y-3">
            {qualityData.warnings.map((warning, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-[rgba(250,204,21,0.14)] rounded-lg">
                <AlertTriangle className="h-5 w-5 text-[#FDE047] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{warning.column}</div>
                  <div className="text-sm text-foreground/80 mt-1">{warning.issue}</div>
                  {warning.severity && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Severity: {warning.severity}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

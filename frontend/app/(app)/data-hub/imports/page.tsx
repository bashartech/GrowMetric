"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { ImportJobDTO } from "@/lib/types";

interface ImportsListResponse {
  imports: ImportJobDTO[];
  meta: { page: number; pageSize: number; total: number; hasMore: boolean };
}

const statusConfig: Record<
  ImportJobDTO["status"],
  { label: string; className: string; dot: string }
> = {
  QUEUED: { label: "Queued", className: "bg-muted text-foreground/80", dot: "bg-muted-foreground" },
  RUNNING: { label: "Processing", className: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]", dot: "bg-[#3B82F6]" },
  REQUESTING_MAPPING: {
    label: "Needs confirmation",
    className: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]",
    dot: "bg-[#FACC15]",
  },
  COMPLETED: { label: "Completed", className: "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]", dot: "bg-[#22C55E]" },
  FAILED: { label: "Failed", className: "bg-[rgba(239,68,68,0.15)] text-[#F87171]", dot: "bg-[#EF4444]" },
};

const statusOptions: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "COMPLETED", label: "Completed" },
  { value: "RUNNING", label: "Processing" },
  { value: "REQUESTING_MAPPING", label: "Needs confirmation" },
  { value: "FAILED", label: "Failed" },
  { value: "QUEUED", label: "Queued" },
];

export default function ImportsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["imports", page, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (status) params.set("status", status);
      return api.get<ImportsListResponse>(`/imports?${params.toString()}`);
    },
  });

  if (isLoading) {
    return <Loading label="Loading imports..." />;
  }

  if (error) {
    return (
      <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
    );
  }

  const imports = data?.imports ?? [];
  const meta = data?.meta ?? { page: 1, pageSize: 20, total: 0, hasMore: false };

  const handleStatusChange = (value: string) => {
    setStatus(value);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Imports</h1>
          <p className="text-muted-foreground mt-1">
            {meta.total} {meta.total === 1 ? "import" : "imports"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="import-status-filter" className="text-sm text-muted-foreground">
            Filter
          </label>
          <select
            id="import-status-filter"
            value={status}
            onChange={(event) => handleStatusChange(event.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {imports.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No imports yet"
          description="Upload files from Data Sources to see import history here"
        />
      ) : (
        <Card className="divide-y overflow-hidden">
          {imports.map((importJob) => {
            const status = statusConfig[importJob.status];
            return (
              <div key={importJob.id} className="px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${status.className}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    <span className="text-sm font-medium truncate">{importJob.filename}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {importJob.source === "TABLE_SYNC" ? "Table sync" : "Upload"} &middot;{" "}
                    {importJob.dataSource.name}
                    {importJob.dataset ? ` · into "${importJob.dataset.name}"` : ""}
                  </p>
                  {importJob.status === "FAILED" && importJob.error ? (
                    <p className="text-xs text-[#F87171] mt-1">{importJob.error}</p>
                  ) : null}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm text-foreground/80">
                    {importJob.totalRows !== null
                      ? `${importJob.totalRows.toLocaleString()} rows`
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">
                    {new Date(importJob.createdAt).toLocaleString()}
                  </p>
                  {importJob.completedAt ? (
                    <p className="text-xs text-muted-foreground/70">
                      Finished {new Date(importJob.completedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {meta.total > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} of {Math.max(1, Math.ceil(meta.total / meta.pageSize))}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta.hasMore}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
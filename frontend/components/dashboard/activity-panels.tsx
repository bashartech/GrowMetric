"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, Gauge, Upload } from "lucide-react";
import { RadialGauge } from "@/components/charts";
import { useEntitlements, useUsage } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import type { ImportJobDTO } from "@/lib/types";
import { PanelShell } from "./panel-shell";

const IMPORT_STATUS_STYLES: Record<ImportJobDTO["status"], string> = {
  QUEUED: "bg-muted text-foreground/80",
  RUNNING: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]",
  REQUESTING_MAPPING: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]",
  COMPLETED: "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]",
  FAILED: "bg-[rgba(239,68,68,0.15)] text-[#F87171]",
};

const IMPORT_STATUS_LABELS: Record<ImportJobDTO["status"], string> = {
  QUEUED: "Queued",
  RUNNING: "Processing",
  REQUESTING_MAPPING: "Needs confirmation",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

const RecentImportsPanel = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-imports"],
    queryFn: () => api.imports.list({ page: 1, pageSize: 5 }),
    staleTime: 30_000,
  });

  const imports = data?.imports ?? [];

  return (
    <PanelShell
      title="Recent imports"
      icon={Upload}
      count={data?.meta.total}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      isEmpty={imports.length === 0}
      emptyMessage="No imports yet — upload a file to get started."
    >
      <ul className="space-y-3">
        {imports.slice(0, 5).map((job) => (
          <li key={job.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{job.filename}</p>
              <p className="text-xs text-muted-foreground">{shortDate(job.createdAt)}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                IMPORT_STATUS_STYLES[job.status],
              )}
            >
              {IMPORT_STATUS_LABELS[job.status]}
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
};

const QUALITY_STATUS_STYLES: Record<string, string> = {
  CLEAN: "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]",
  WARNINGS: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]",
  ERROR: "bg-[rgba(239,68,68,0.15)] text-[#F87171]",
};

/** Composite health score: everything that pushes a report to WARNINGS/ERROR,
 * subtracted from a perfect 100 and clamped. */
const qualityScore = (report: {
  missingValuePct: number;
  duplicateRowPct: number;
  invalidNumberPct: number;
  invalidDatePct: number;
}): number =>
  Math.round(
    Math.min(
      Math.max(
        100 -
          report.missingValuePct -
          report.duplicateRowPct -
          report.invalidNumberPct -
          report.invalidDatePct,
        0,
      ),
      100,
    ),
  );

const DataQualityPanel = () => {
  const datasetsQuery = useQuery({
    queryKey: ["dashboard-datasets"],
    queryFn: () => api.datasets.list(),
    staleTime: 60_000,
  });
  const datasetId = datasetsQuery.data?.datasets?.[0]?.id;

  const qualityQuery = useQuery({
    queryKey: ["dashboard-quality", datasetId],
    queryFn: () => api.datasets.quality(datasetId!),
    enabled: Boolean(datasetId),
    staleTime: 60_000,
  });

  const isLoading = datasetsQuery.isLoading || qualityQuery.isLoading;
  const error = datasetsQuery.error ?? qualityQuery.error;
  const report = qualityQuery.data;
  const hasDataset = Boolean(datasetId);

  return (
    <PanelShell
      title="Data quality"
      icon={Gauge}
      isLoading={isLoading}
      error={error}
      onRetry={() => {
        void datasetsQuery.refetch();
        void qualityQuery.refetch();
      }}
      isEmpty={!isLoading && !error && (!hasDataset || !report)}
      emptyMessage={
        hasDataset
          ? "No quality report for this dataset yet."
          : "Connect a dataset to see its quality score."
      }
    >
      {report ? (
        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">
              {report.totalRows.toLocaleString()} rows
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                QUALITY_STATUS_STYLES[report.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {report.status}
            </span>
          </div>
          <RadialGauge value={qualityScore(report)} label="score" />
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {report.columnCount} columns monitored
          </p>
        </div>
      ) : null}
    </PanelShell>
  );
};

interface UsageRowProps {
  label: string;
  limit: number | boolean | undefined;
  used: number | undefined;
}

const UsageRow = ({ label, limit, used }: UsageRowProps) => {
  const hasLimit = typeof limit === "number" && limit > 0;
  const usedText = used === undefined ? "—" : used.toLocaleString();
  const limitText =
    limit === true ? "Unlimited" : typeof limit === "number" ? limit.toLocaleString() : null;
  const pct =
    hasLimit && used !== undefined ? Math.min((used / (limit as number)) * 100, 100) : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {usedText}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {limitText ? `/ ${limitText}` : ""}
          </span>
        </span>
      </div>
      {pct !== null ? (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-700",
              pct >= 90 ? "bg-[#FACC15]" : "bg-[#3B82F6]",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

const UsagePanel = () => {
  const entitlements = useEntitlements();
  const importsUsage = useUsage("imports");
  const datasetsUsage = useUsage("datasets");

  const features = entitlements.data?.features;
  const plan = entitlements.data?.plan;
  const subscription = entitlements.data?.subscription;

  const isLoading = entitlements.isLoading;
  const error = entitlements.error;

  return (
    <PanelShell
      title="Usage vs plan"
      icon={Database}
      isLoading={isLoading}
      error={error}
      onRetry={() => void entitlements.refetch()}
      isEmpty={false}
      emptyMessage=""
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">{plan?.name ?? "—"}</span>
          {subscription ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                subscription.status === "active"
                  ? "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]"
                  : "bg-[rgba(250,204,21,0.14)] text-[#FDE047]",
              )}
            >
              {subscription.status}
            </span>
          ) : null}
        </div>

        <UsageRow
          label="Imports"
          limit={features?.imports}
          used={importsUsage.data?.amount}
        />
        <UsageRow
          label="Datasets"
          limit={features?.datasets}
          used={datasetsUsage.data?.amount}
        />
      </div>
    </PanelShell>
  );
};

export const ActivityPanels = () => (
  <div className="stagger-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <RecentImportsPanel />
    <DataQualityPanel />
    <UsagePanel />
  </div>
);

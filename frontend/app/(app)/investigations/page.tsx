"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, SearchCheck } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { FindingCard } from "@/components/ai/finding-card";
import { RunBadge } from "@/components/ai/run-badge";
import type {
  DatasetColumnDTO,
  FindingLevel,
  InvestigationDetailDTO,
  InvestigationListItemDTO,
  InvestigationPeriodPreset,
} from "@/lib/types";
import Link from "next/link";

const NO_READY_DATASETS_MESSAGE =
  "No analytics-ready datasets exist in this workspace yet. Import data before running an investigation.";

const isNoReadyDatasets = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.code === "CONFLICT" &&
  error.details !== null &&
  typeof error.details === "object" &&
  (error.details as { ready?: boolean }).ready === false;

const READY_STATUSES = new Set(["READY", "READY_WITH_WARNINGS"]);

const CANONICAL_METRICS: Array<{ key: string; label: string }> = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "customers", label: "Customers" },
  { key: "expenses", label: "Expenses" },
  { key: "profit", label: "Profit" },
  { key: "inventory", label: "Inventory" },
];

const PERIOD_PRESETS: Array<{ value: InvestigationPeriodPreset; label: string }> = [
  { value: "LAST_3_MONTHS", label: "Last 3 months" },
  { value: "LAST_6_MONTHS", label: "Last 6 months" },
  { value: "LAST_12_MONTHS", label: "Last 12 months" },
];

const LEVEL_GROUPS: Array<{ level: FindingLevel; label: string }> = [
  { level: "MAIN", label: "Main result" },
  { level: "SUPPORTING", label: "Supporting detail" },
  { level: "CORRELATION", label: "Correlations (not causation)" },
];

const metricsMappedIn = (columns: DatasetColumnDTO[]): string[] => {
  const mapped = new Set<string>();
  for (const column of columns) {
    const semanticKey = column.semanticKey?.toLowerCase();
    const name = column.name?.toLowerCase();
    for (const metric of CANONICAL_METRICS) {
      if (semanticKey === metric.key || name === metric.key) mapped.add(metric.key);
    }
  }
  return CANONICAL_METRICS.filter((metric) => mapped.has(metric.key)).map(
    (metric) => metric.key,
  );
};

export default function InvestigationsPage() {
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const [periodPreset, setPeriodPreset] =
    useState<InvestigationPeriodPreset>("LAST_3_MONTHS");

  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: ["ai-investigations"],
    queryFn: () => api.ai.investigations.list(),
  });

  const { data: datasetsData } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api.datasets.list(),
  });

  const readyDatasets = useMemo(
    () =>
      (datasetsData?.datasets ?? []).filter(
        (dataset) => READY_STATUSES.has(dataset.status) && dataset.rowCount > 0,
      ),
    [datasetsData],
  );

  const effectiveDatasetId =
    datasetId && readyDatasets.some((dataset) => dataset.id === datasetId)
      ? datasetId
      : (readyDatasets[0]?.id ?? null);

  const { data: datasetDetail, isLoading: datasetLoading } = useQuery({
    queryKey: ["dataset", effectiveDatasetId],
    queryFn: () => api.datasets.get(effectiveDatasetId as string),
    enabled: effectiveDatasetId !== null,
  });

  const availableMetrics = useMemo(
    () => metricsMappedIn(datasetDetail?.columns ?? []),
    [datasetDetail],
  );

  const effectiveMetricKey =
    metricKey && availableMetrics.includes(metricKey)
      ? metricKey
      : (availableMetrics[0] ?? null);

  const investigations = useMemo<InvestigationListItemDTO[]>(
    () => listData?.items ?? [],
    [listData],
  );
  const activeId = selectedId ?? investigations[0]?.id ?? null;

  const {
    data: investigation,
    isLoading: investigationLoading,
    error: investigationError,
    refetch: refetchInvestigation,
  } = useQuery({
    queryKey: ["ai-investigation", activeId],
    queryFn: () => api.ai.investigations.get(activeId as string),
    enabled: activeId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "RUNNING" ? 2000 : false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.ai.investigations.create({
        title: title.trim(),
        question: question.trim(),
        topic: effectiveMetricKey as string,
        datasetId: effectiveDatasetId ?? undefined,
        periodPreset,
      }),
    onSuccess: (created) => {
      setTitle("");
      setQuestion("");
      setSelectedId(created.id);
      void queryClient.invalidateQueries({ queryKey: ["ai-investigations"] });
    },
  });

  const canSubmit =
    title.trim().length > 0 &&
    question.trim().length > 0 &&
    effectiveDatasetId !== null &&
    effectiveMetricKey !== null;

  const handleCreate = () => {
    if (!canSubmit || createMutation.isPending) return;
    createMutation.mutate();
  };

  const groups = (investigation?.findings ?? [])
    .map((finding) => ({ ...finding }))
    .reduce<Array<{ level: FindingLevel; label: string; items: InvestigationDetailDTO["findings"] }>>(
      (acc, finding) => {
        const group = LEVEL_GROUPS.find((entry) => entry.level === finding.level);
        if (!group) return acc;
        let bucket = acc.find((entry) => entry.level === group.level);
        if (!bucket) {
          bucket = { ...group, items: [] };
          acc.push(bucket);
        }
        bucket.items.push(finding);
        return acc;
      },
      [],
    );

  if (listLoading) {
    return <Loading label="Loading investigations..." />;
  }

  if (listError) {
    return <ErrorState message={(listError as Error).message} />;
  }

  const showCreateForm = investigations.length === 0;
  const noMetricsMapped =
    effectiveDatasetId !== null && !datasetLoading && availableMetrics.length === 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Investigations</h1>
          <p className="text-muted-foreground mt-1">
            Dig into changes and anomalies with a guided, evidence-backed analysis.
          </p>
        </div>
        {!showCreateForm ? (
          <Button variant="outline" onClick={() => titleRef.current?.focus()}>
            <SearchCheck className="h-4 w-4" />
            New investigation
          </Button>
        ) : null}
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="inv-title" className="text-sm font-medium">
              Title
            </label>
            <input
              id="inv-title"
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Revenue dip in February"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="inv-question" className="text-sm font-medium">
              Question
            </label>
            <input
              id="inv-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Compare the latest period with the one before it."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="inv-dataset" className="text-sm font-medium">
              Dataset
            </label>
            <select
              id="inv-dataset"
              value={effectiveDatasetId ?? ""}
              onChange={(event) => setDatasetId(event.target.value || null)}
              disabled={readyDatasets.length === 0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {readyDatasets.length === 0 ? (
                <option value="">No analytics-ready datasets</option>
              ) : (
                readyDatasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="inv-metric" className="text-sm font-medium">
              Metric
            </label>
            <select
              id="inv-metric"
              value={effectiveMetricKey ?? ""}
              onChange={(event) => setMetricKey(event.target.value || null)}
              disabled={availableMetrics.length === 0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {availableMetrics.length === 0 ? (
                <option value="">
                  {datasetLoading ? "Loading…" : "No mapped metric"}
                </option>
              ) : (
                availableMetrics.map((key) => {
                  const metric = CANONICAL_METRICS.find((entry) => entry.key === key);
                  return (
                    <option key={key} value={key}>
                      {metric?.label ?? key}
                    </option>
                  );
                })
              )}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="inv-period" className="text-sm font-medium">
              Period
            </label>
            <select
              id="inv-period"
              value={periodPreset}
              onChange={(event) =>
                setPeriodPreset(event.target.value as InvestigationPeriodPreset)
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {PERIOD_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {noMetricsMapped ? (
          <div className="rounded-md border border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.14)] p-3 text-sm text-[#FDE047]">
            This dataset has no mapped business metric (revenue, orders, profit,
            expenses, customers, inventory).{" "}
            <Link
              href="/data-hub/datasets"
              className="font-medium underline underline-offset-2"
            >
              Map one in Data Hub
            </Link>{" "}
            and try again.
          </div>
        ) : null}

        {createMutation.isError ? (
          <div
            data-testid="create-error"
            className={
              isNoReadyDatasets(createMutation.error)
                ? "flex items-start gap-3 rounded-md border border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.14)] p-3 text-sm text-[#FDE047]"
                : "rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] p-3 text-sm text-[#F87171]"
            }
          >
            {isNoReadyDatasets(createMutation.error) ? (
              <span className="inline-flex items-start gap-2">
                <Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {NO_READY_DATASETS_MESSAGE}{" "}
                  <Link
                    href="/data-hub/datasets"
                    className="font-medium underline underline-offset-2"
                  >
                    Go to datasets
                  </Link>
                </span>
              </span>
            ) : (
              <span>{(createMutation.error as Error).message}</span>
            )}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            onClick={handleCreate}
            loading={createMutation.isPending}
            disabled={!canSubmit || createMutation.isPending}
            aria-label="Run investigation"
          >
            <SearchCheck className="h-4 w-4" />
            Run investigation
          </Button>
        </div>
      </Card>

      {showCreateForm ? (
        <Card className="p-10">
          <EmptyState
            icon={<SearchCheck className="h-12 w-12" />}
            title="No investigations yet"
            description="Describe what you want to investigate and the pipeline will compare periods over your own data."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit lg:sticky lg:top-24 max-h-[70vh] overflow-y-auto">
            <div className="p-3">
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Investigations
              </p>
              <ul className="space-y-1">
                {investigations.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={
                        activeId === item.id
                          ? "w-full rounded-md bg-accent px-3 py-2 text-left text-sm font-medium"
                          : "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                      }
                    >
                      <span className="block truncate">{item.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.status} · {item.findingCount} finding
                        {item.findingCount === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  {investigation?.title ?? "Investigation"}
                </h2>
                <div className="flex items-center gap-2">
                  {investigation?.status === "RUNNING" ? (
                    <Loading label="Investigation in progress…" />
                  ) : investigation?.agentRun ? (
                    <RunBadge status={investigation.agentRun.status} />
                  ) : null}
                </div>
              </div>
              {investigation?.question ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {investigation.question}
                </p>
              ) : null}
            </Card>

            {investigationLoading && !investigation ? (
              <Loading label="Loading investigation..." />
            ) : investigationError ? (
              <ErrorState
                message={(investigationError as Error).message}
                onRetry={() => refetchInvestigation()}
              />
            ) : investigation?.status === "FAILED" ? (
              <Card className="p-6">
                <ErrorState
                  message={investigation.error ?? "The investigation failed."}
                />
              </Card>
            ) : investigation && investigation.findings.length > 0 ? (
              groups.map((group) => (
                <section key={group.level} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                  {group.items.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </section>
              ))
            ) : investigation && investigation.status === "COMPLETED" ? (
              <Card className="p-10">
                <EmptyState
                  icon={<SearchCheck className="h-10 w-10" />}
                  title="No findings produced"
                  description="The investigation completed but produced no findings for the selected periods."
                />
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

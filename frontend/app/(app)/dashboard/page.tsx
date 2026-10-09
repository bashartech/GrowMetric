"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Filter,
  X,
  ChevronDown,
  RefreshCw,
  BarChart2,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Table,
  LayoutDashboard,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import {
  KPICard,
  LineChart,
  BarChart,
  PieChart as PieChartComponent,
  DataTable,
} from "@/components/charts";
import { SummaryPanel } from "@/components/dashboard/summary-panel";
import { InsightsPanels } from "@/components/dashboard/insights-panels";
import { ActivityPanels } from "@/components/dashboard/activity-panels";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { dateInputToEndOfDay, dateInputToStartOfDay } from "@/lib/date-filters";
import type { DashboardWidgetDataDTO, MetricFilters } from "@/lib/types";

const WIDGET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  KPI: LayoutDashboard,
  LINE: LineChartIcon,
  BAR: BarChart2,
  PIE: PieChartIcon,
  TABLE: Table,
};

const WIDGET_COMPONENTS: Record<
  string,
  React.FC<{ data: DashboardWidgetDataDTO["data"]; title: string; className?: string }>
> = {
  KPI: KPICard,
  LINE: LineChart,
  BAR: BarChart,
  PIE: PieChartComponent,
  TABLE: DataTable,
};

const DATE_PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
];

function getDateFromPreset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export default function DashboardPage() {
  const [filters, setFilters] = useState<MetricFilters>({
    dateFrom: getDateFromPreset(30),
    dateTo: new Date().toISOString(),
  });

  const {
    data: dashboardsData,
    isLoading: dashboardsLoading,
    error: dashboardsError,
  } = useQuery({
    queryKey: ["dashboards"],
    queryFn: () => api.dashboards.list(),
  });

  const defaultDashboard = dashboardsData?.dashboards?.[0];
  const dashboardId = defaultDashboard?.id;

  const {
    data: previewData,
    isLoading: previewLoading,
    isFetching: previewFetching,
    error: previewError,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: ["dashboard-preview", dashboardId, filters],
    queryFn: () => api.dashboards.preview(dashboardId!, { filters }),
    enabled: !!dashboardId,
  });

  const handleFilterChange = (key: keyof MetricFilters, value: string | undefined) => {
    setFilters((prev: MetricFilters) => ({ ...prev, [key]: value }));
  };

  const handlePresetSelect = (days: number) => {
    setFilters((prev: MetricFilters) => ({
      ...prev,
      dateFrom: getDateFromPreset(days),
      dateTo: new Date().toISOString(),
    }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const hasActiveFilters = Boolean(
    filters.dateFrom || filters.dateTo || filters.dateColumnId || Object.keys(filters.dimensions ?? {}).length,
  );

  if (dashboardsLoading) {
    return <Loading label="Loading dashboard..." />;
  }

  if (dashboardsError) {
    return (
      <ErrorState
        message={(dashboardsError as Error).message}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!defaultDashboard) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">No dashboard configured yet</p>
          </div>
        </div>
        <Card className="p-10">
          <EmptyState
            icon={<LayoutDashboard className="h-12 w-12" />}
            title="No dashboard available"
            description="Create a data source and import data to see your first dashboard"
          />
        </Card>
      </div>
    );
  }

  if (previewLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{defaultDashboard.name}</h1>
            <p className="text-muted-foreground mt-1">Loading dashboard data...</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchPreview()}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-4 skeleton rounded w-1/4 mb-4" />
              <div className="h-8 skeleton rounded w-1/2" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{defaultDashboard.name}</h1>
            <p className="text-muted-foreground mt-1">Failed to load dashboard</p>
          </div>
        </div>
        <ErrorState
          message={(previewError as Error).message}
          onRetry={() => refetchPreview()}
        />
      </div>
    );
  }

  const widgets = previewData?.widgets ?? [];
  const anyAvailable = widgets.some((w) => w.data.available);

  const kpis = widgets.filter((widget) => widget.type === "KPI");
  const lineWidget = widgets.find((widget) => widget.type === "LINE");
  const barWidget = widgets.find((widget) => widget.type === "BAR");
  const pieWidget = widgets.find((widget) => widget.type === "PIE");
  const tableWidget = widgets.find((widget) => widget.type === "TABLE");
  const placedIds = new Set(
    [
      ...kpis.map((widget) => widget.id),
      lineWidget?.id,
      barWidget?.id,
      pieWidget?.id,
      tableWidget?.id,
    ].filter((id): id is string => Boolean(id)),
  );
  const extraWidgets = widgets.filter((widget) => !placedIds.has(widget.id));

  const lineUnit = lineWidget?.data.metricKind
    ? kpis.find((widget) => widget.data.metricKind === lineWidget.data.metricKind)?.data.unit
    : undefined;

  return (
    <div className="space-y-6 p-6">
      {/* Header: name, live-data status, presets, filters, refresh */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{defaultDashboard.name}</h1>
          <p className="text-muted-foreground mt-1">
            {widgets.length} widget{widgets.length !== 1 ? "s" : ""} •{" "}
            {anyAvailable ? "Showing live data" : "No data available — connect a dataset"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1"
            role="group"
            aria-label="Date presets"
          >
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.days}
                variant="ghost"
                size="sm"
                onClick={() => handlePresetSelect(preset.days)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <Dropdown
            trigger={
              <Button variant="outline" size="sm" className="gap-2" aria-haspopup="dialog">
                <Filter className="h-4 w-4" />
                Filters
                <ChevronDown className="h-4 w-4" />
                {hasActiveFilters && (
                  <span className="bg-[rgba(59,130,246,0.15)] text-[#60A5FA] text-xs px-1.5 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </Button>
            }
            align="right"
          >
            <div className="w-80 p-4 space-y-4">
              <div>
                <p className="block text-sm font-medium text-foreground/80 mb-2">
                  Date Range
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="dashboard-filter-from"
                      className="block text-xs text-muted-foreground mb-1"
                    >
                      From
                    </label>
                    <input
                      id="dashboard-filter-from"
                      type="date"
                      value={filters.dateFrom?.split("T")[0] ?? ""}
                      onChange={(e) =>
                        handleFilterChange("dateFrom", e.target.value ? dateInputToStartOfDay(e.target.value) : undefined)
                      }
                      className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="dashboard-filter-to"
                      className="block text-xs text-muted-foreground mb-1"
                    >
                      To
                    </label>
                    <input
                      id="dashboard-filter-to"
                      type="date"
                      value={filters.dateTo?.split("T")[0] ?? ""}
                      onChange={(e) =>
                        handleFilterChange("dateTo", e.target.value ? dateInputToEndOfDay(e.target.value) : undefined)
                      }
                      className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="block text-sm font-medium text-foreground/80 mb-2">
                  Dimensions
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  Dimension filters require a dataset with categorical columns
                </p>
              </div>

              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="w-full">
                  <X className="h-4 w-4 mr-2" />
                  Clear all filters
                </Button>
              )}
            </div>
          </Dropdown>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchPreview()}
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={cn("h-4 w-4", previewFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <Card className="p-10">
          <EmptyState
            icon={<LayoutDashboard className="h-12 w-12" />}
            title="No widgets configured"
            description="Add widgets to your dashboard to start visualizing data"
          />
        </Card>
      ) : (
        <>
          {/* Stat strip */}
          {kpis.length > 0 && (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 stagger-grid">
              {kpis.map((widget) => (
                <KPICard key={widget.id} data={widget.data} title={widget.title} />
              ))}
            </div>
          )}

          {/* Hero: trend chart + derived summary */}
          {lineWidget && (
            <div className="grid gap-4 lg:grid-cols-3 stagger-grid">
              <div className="lg:col-span-2">
                <LineChart
                  data={lineWidget.data}
                  title={lineWidget.title}
                  chartClassName="h-[340px]"
                />
              </div>
              <SummaryPanel
                rows={lineWidget.data.rows ?? []}
                unit={lineUnit}
              />
            </div>
          )}

          {/* Secondary charts */}
          {(barWidget || pieWidget) && (
            <div className="grid gap-4 md:grid-cols-2 stagger-grid">
              {barWidget && (
                <BarChart data={barWidget.data} title={barWidget.title} />
              )}
              {pieWidget && (
                <PieChartComponent data={pieWidget.data} title={pieWidget.title} />
              )}
            </div>
          )}

          {tableWidget && (
            <div className="stagger-in">
              <DataTable data={tableWidget.data} title={tableWidget.title} />
            </div>
          )}

          {/* Any remaining shapes fall back to a generic grid */}
          {extraWidgets.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 stagger-grid">
              {extraWidgets.map((widget) => {
                const WidgetComponent = WIDGET_COMPONENTS[widget.type];
                const Icon = WIDGET_ICONS[widget.type];

                if (!WidgetComponent) {
                  return (
                    <Card key={widget.id} className="p-6">
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Unknown widget type: {widget.type}
                        </span>
                      </div>
                    </Card>
                  );
                }

                return (
                  <WidgetComponent
                    key={widget.id}
                    data={widget.data}
                    title={widget.title}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {!anyAvailable && widgets.length > 0 && (
        <Card className="p-6 border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.14)]">
          <div className="flex items-center gap-3">
            <PieChartIcon className="h-5 w-5 text-[#FDE047]" />
            <div>
              <p className="font-medium text-[#FDE047]">No data available for current filters</p>
              <p className="text-sm text-[#FDE047]">
                Your dashboard is configured but the connected dataset does not have data matching the current
                filters, or no dataset is connected to the widgets. Try adjusting the date range or connect a
                dataset with relevant data.
              </p>
            </div>
          </div>
        </Card>
      )}

      <InsightsPanels />
      <ActivityPanels />
    </div>
  );
}

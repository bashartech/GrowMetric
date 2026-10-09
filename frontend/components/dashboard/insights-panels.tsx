"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Bell, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { PanelShell } from "./panel-shell";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const SEVERITY_STYLES: Record<Severity, string> = {
  CRITICAL: "bg-[rgba(239,68,68,0.14)] text-[#F87171]",
  HIGH: "bg-[rgba(239,68,68,0.14)] text-[#F87171]",
  MEDIUM: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]",
  LOW: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]",
};

export const SeverityBadge = ({ severity }: { severity: string }) => (
  <span
    className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
      SEVERITY_STYLES[severity as Severity] ?? SEVERITY_STYLES.LOW,
    )}
  >
    {severity}
  </span>
);

const AnomaliesPanel = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-anomalies"],
    queryFn: () => api.anomalyDetections.list({ limit: 4 }),
    staleTime: 60_000,
  });

  const anomalies = data?.anomalies ?? [];

  return (
    <PanelShell
      title="Anomalies"
      icon={Activity}
      count={data?.total}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      isEmpty={anomalies.length === 0}
      emptyMessage="No anomalies detected in this workspace."
    >
      <ul className="space-y-3">
        {anomalies.slice(0, 4).map((anomaly) => (
          <li key={anomaly.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    anomaly.kind === "SPIKE"
                      ? "bg-[rgba(239,68,68,0.14)] text-[#F87171]"
                      : "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]",
                  )}
                >
                  {anomaly.kind}
                </span>
                <span className="truncate text-xs text-muted-foreground">{anomaly.period}</span>
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
              {anomaly.deviationPct > 0 ? "+" : ""}
              {anomaly.deviationPct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
};

const RecommendationsPanel = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-recommendations"],
    queryFn: () => api.recommendations.list({ status: "OPEN" }),
    staleTime: 60_000,
  });

  const recommendations = data?.recommendations ?? [];

  return (
    <PanelShell
      title="Recommendations"
      icon={Sparkles}
      count={recommendations.length}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      isEmpty={recommendations.length === 0}
      emptyMessage="No open recommendations right now."
    >
      <ul className="space-y-3">
        {recommendations.slice(0, 4).map((item) => (
          <li key={item.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
              <SeverityBadge severity={item.severity} />
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
};

const AlertsPanel = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: () => api.alerts.list({ limit: 4 }),
    staleTime: 60_000,
  });

  const alerts = data?.alerts ?? [];

  return (
    <PanelShell
      title="Alerts"
      icon={Bell}
      count={alerts.length}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      isEmpty={alerts.length === 0}
      emptyMessage="No triggered alerts."
    >
      <ul className="space-y-3">
        {alerts.slice(0, 4).map((alert) => (
          <li key={alert.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">{alert.title}</p>
              <SeverityBadge severity={alert.severity} />
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{alert.message}</p>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
};

export const InsightsPanels = () => (
  <div className="stagger-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <AnomaliesPanel />
    <RecommendationsPanel />
    <AlertsPanel />
  </div>
);

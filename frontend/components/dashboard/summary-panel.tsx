"use client";

import { Card } from "@/components/ui/card";
import { formatValue } from "@/components/charts";

interface SummaryPanelProps {
  rows: Array<{ group: string; value: number }>;
  unit?: string;
  title?: string;
}

/**
 * Side panel next to the hero chart: aggregates the trend rows into the four
 * numbers an analyst glances at first — total, best bucket, average, and how
 * much of the total the best bucket represents.
 */
export const SummaryPanel = ({ rows, unit, title = "Summary" }: SummaryPanelProps) => {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const top = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (best === null || row.value > best.value ? row : best),
    null,
  );
  const average = rows.length > 0 ? total / rows.length : null;
  const share = top && total > 0 ? (top.value / total) * 100 : null;

  const stats: Array<{
    label: string;
    value: string;
    caption?: string;
    share?: number | null;
  }> = [
    { label: "Total", value: rows.length > 0 ? formatValue(total, unit) : "—" },
    {
      label: "Top group",
      value: top ? top.group : "—",
      caption: top ? formatValue(top.value, unit) : undefined,
    },
    { label: "Average", value: average !== null ? formatValue(average, unit) : "—" },
    {
      label: "Top share",
      value: share !== null ? `${share.toFixed(1)}%` : "—",
      share,
    },
  ];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3B82F6]" aria-hidden />
          {rows.length > 0 ? `${rows.length} periods` : "no data"}
        </span>
      </div>

      <dl className="space-y-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-muted-foreground">{stat.label}</dt>
              <dd className="truncate text-right text-sm font-semibold tabular-nums text-foreground">
                {stat.value}
                {stat.caption ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {stat.caption}
                  </span>
                ) : null}
              </dd>
            </div>
            {stat.share !== undefined ? (
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${stat.label} ${stat.share !== null ? Math.round(stat.share) : 0}%`}
                aria-valuenow={stat.share !== null ? Math.round(stat.share) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#22D3EE] transition-[width] duration-700"
                  style={{ width: `${Math.min(Math.max(stat.share ?? 0, 0), 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </dl>
    </Card>
  );
};

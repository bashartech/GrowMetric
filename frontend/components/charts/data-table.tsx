"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/signals/empty-state";
import type { DashboardWidgetDataDTO } from "@/lib/types";

interface DataTableProps {
  data: DashboardWidgetDataDTO["data"];
  title: string;
  className?: string;
}

export const DataTable = ({ data, title, className }: DataTableProps) => {
  const { available, rows, total } = data;

  if (!available || !rows || rows.length === 0) {
    return (
      <Card className={cn("p-5", className)}>
        <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <EmptyState
          title="No data available"
          description="This table requires a dataset with categorical data"
        />
      </Card>
    );
  }

  const maxValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <Card className={cn("p-5", className)}>
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Category
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row, index) => (
              <tr
                key={index}
                className="group transition-colors hover:bg-[var(--surface-hover)]"
              >
                <td className="relative max-w-[140px] truncate px-3 py-2.5 text-foreground/90">
                  {row.group}
                </td>
                <td className="relative px-3 py-2.5 text-right font-medium tabular-nums">
                  <span
                    className="absolute inset-y-1 right-1 rounded bg-[rgba(59,130,246,0.14)] transition-colors group-hover:bg-[rgba(59,130,246,0.22)]"
                    style={{ width: `${(Math.abs(row.value) / maxValue) * 88}%` }}
                    aria-hidden
                  />
                  <span className="relative">{row.value.toLocaleString()}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {total !== undefined && (
          <div className="mt-4 flex justify-between border-t border-[var(--border)] pt-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums text-foreground">
              {total.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
};

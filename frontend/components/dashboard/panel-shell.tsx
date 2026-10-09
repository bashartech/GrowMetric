"use client";

import { RotateCcw, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface PanelShellProps {
  title: string;
  icon: LucideIcon;
  count?: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyMessage: string;
  isEmpty: boolean;
  children: React.ReactNode;
}

/**
 * Consistent chrome for the dashboard's side panels: title row with an icon
 * and count badge, skeleton while loading, honest inline failure with retry,
 * and a muted one-liner when there is simply nothing to show. Panel failures
 * never take down the main dashboard.
 */
export const PanelShell = ({
  title,
  icon: Icon,
  count,
  isLoading,
  error,
  onRetry,
  emptyMessage,
  isEmpty,
  children,
}: PanelShellProps) => (
  <Card className="p-5">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      {count !== undefined && count > 0 ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </div>

    {isLoading ? (
      <div className="space-y-2" aria-label={`Loading ${title}`}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    ) : error ? (
      <div className="flex items-center justify-between gap-3 py-2">
        <p className="text-xs text-muted-foreground">Couldn&apos;t load {title.toLowerCase()}.</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          aria-label={`Retry loading ${title}`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    ) : isEmpty ? (
      <p className="py-2 text-xs text-muted-foreground">{emptyMessage}</p>
    ) : (
      children
    )}
  </Card>
);

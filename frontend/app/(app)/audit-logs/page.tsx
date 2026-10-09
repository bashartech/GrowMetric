"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { useAuditLogs } from "@/hooks/use-audit-logs";

const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useAuditLogs(page, PAGE_SIZE);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          A read-only history of important account actions. Secrets are never
          recorded.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          description="Account and settings actions will appear here as they happen."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm">
              {data.items.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{entry.action}</p>
                    <p className="truncate text-muted-foreground">
                      {entry.actor ? entry.actor.name : "System"}
                      {entry.resourceType ? ` · ${entry.resourceType}` : ""}
                    </p>
                  </div>
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={entry.createdAt}
                  >
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data && data.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

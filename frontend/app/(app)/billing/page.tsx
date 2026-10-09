"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/signals/error-state";
import { useEntitlements } from "@/hooks/use-entitlements";

function humanizeFeature(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function formatLimit(value: number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Included" : "Not included";
  }
  return value < 0 ? "Unlimited" : `${value} per period`;
}

export default function BillingPage() {
  const { data, isLoading, isError, refetch } = useEntitlements();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your current plan and included capabilities. Plan changes arrive in a
          later phase.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{data.plan.name} plan</CardTitle>
              <CardDescription>
                {data.subscription
                  ? `${data.subscription.status} · renews ${new Date(
                      data.subscription.currentPeriodEnd,
                    ).toLocaleDateString()}`
                  : "No active subscription"}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Included capabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {Object.entries(data.features).map(([key, value]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="text-muted-foreground">
                      {humanizeFeature(key)}
                    </span>
                    <span className="font-medium">{formatLimit(value)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

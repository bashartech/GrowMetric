"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { EntitlementsDTO, UsageDTO } from "@/lib/types";

export function useEntitlements() {
  return useQuery({
    queryKey: ["entitlements"],
    queryFn: () => api.get<EntitlementsDTO>("/entitlements"),
    staleTime: 60_000,
  });
}

export function useUsage(metric: string) {
  return useQuery({
    queryKey: ["usage", metric],
    queryFn: () => api.get<UsageDTO>(`/usage?metric=${encodeURIComponent(metric)}`),
    staleTime: 30_000,
  });
}

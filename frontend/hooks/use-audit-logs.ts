"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AuditLogDTO, PaginatedDTO } from "@/lib/types";

export function useAuditLogs(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ["audit-logs", page, pageSize],
    queryFn: () =>
      api.get<PaginatedDTO<AuditLogDTO>>(
        `/audit-logs?page=${page}&pageSize=${pageSize}`,
      ),
    staleTime: 15_000,
  });
}

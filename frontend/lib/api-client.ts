import type { ApiFailure, ApiSuccess, PageMeta } from "./types";

/**
 * Relative by default so every request is same-origin and the `SameSite=lax`
 * auth cookies are always sent. `next.config.ts` proxies `/api/v1/*` to the
 * backend (BACKEND_ORIGIN), which keeps localhost and production identical.
 *
 * Set NEXT_PUBLIC_API_URL only if the API must be addressed cross-origin, and
 * be aware that also requires `SameSite=None; Secure` cookies.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    error: { code: string; message: string; details?: unknown },
  ) {
    super(error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  skipAuthRefresh?: boolean;
  retried?: boolean;
  signal?: AbortSignal;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const failure = payload as ApiFailure | null;
    throw new ApiError(
      response.status,
      failure?.error ?? {
        code: "INTERNAL_ERROR",
        message: "Unexpected error occurred.",
      },
    );
  }

  const payloadObj = payload as Record<string, unknown> | null;

  // Every API response is wrapped as { success: true, data: ... }. `data` keeps
  // its own shape (e.g. `{ reports: [...] }`, `{ rules: [...] }`) so callers can
  // read the named collection.
  if (payloadObj && typeof payloadObj.success === "boolean") {
    const success = payload as ApiSuccess<T> | null;
    if (!success || success.success !== true) {
      throw new ApiError(response.status, {
        code: "INTERNAL_ERROR",
        message: "Malformed server response.",
      });
    }
    return success.data;
  }

  // Un-enveloped response: return it untouched. Do NOT pick a key out of it.
  // Doing so silently reshapes the payload (a `{ rules: [...] }` body would
  // arrive as a bare array) and every list page reading `result.rules` renders
  // empty with no error. A missing envelope is a server bug and should be loud.
  if (payloadObj) {
    return payloadObj as T;
  }
  
  throw new ApiError(response.status, {
    code: "INTERNAL_ERROR",
    message: "Malformed server response.",
  });
}

export async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    headers,
    skipAuthRefresh = false,
    retried = false,
    signal,
  } = options;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 401 && !skipAuthRefresh && !retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, retried: true });
    }
  }

  return parseEnvelope<T>(response);
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: formData,
    signal: options?.signal,
  });

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiUpload<T>(path, formData, options);
    }
  }

  return parseEnvelope<T>(response);
}

/**
 * Downloads a file to the user's device.
 *
 * The response is fetched rather than linked so that the 401 -> refresh -> retry
 * path is used (a plain <a href> cannot refresh an expired token) and so the
 * bytes are delivered as a same-origin blob. Browsers ignore the `download`
 * attribute on cross-origin URLs, so a direct link would silently fall back to
 * navigating instead of downloading.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const request = async (retried: boolean): Promise<Response> => {
    const response = await fetch(`${API_URL}${path}`, {
      credentials: "include",
    });
    if (response.status === 401 && !retried) {
      if (await refreshSession()) {
        return request(true);
      }
    }
    return response;
  };

  const response = await request(false);

  if (!response.ok) {
    // Errors use the standard envelope; surface the server's message rather
    // than a generic failure. The body is read exactly once.
    let code = "DOWNLOAD_FAILED";
    let message = "The file could not be downloaded.";
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } } | null;
      code = payload?.error?.code ?? code;
      message = payload?.error?.message ?? message;
    } catch {
      // Non-JSON error body (e.g. an upstream 502); keep the defaults.
    }
    throw new ApiError(response.status, { code, message });
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fallbackName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  condition: (data: T) => boolean,
  options?: {
    maxAttempts?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  const { maxAttempts = 60, intervalMs = 2000, signal } = options ?? {};

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error("Polling cancelled");
    }

    const data = await fetcher();
    if (condition(data)) {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Polling timeout exceeded");
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "DELETE" }),
  upload: apiUpload,
  pollUntil,
  dashboards: {
    list: () => api.get<{ dashboards: import("./types").DashboardDTO[] }>("/dashboards"),
    get: (id: string) => api.get<import("./types").DashboardDTO>(`/dashboards/${id}`),
    create: (body: import("./types").DashboardNameInput) =>
      api.post<import("./types").DashboardDTO>("/dashboards", body),
    update: (id: string, body: import("./types").DashboardNameInput) =>
      api.patch<import("./types").DashboardDTO>(`/dashboards/${id}`, body),
    preview: (id: string, body: import("./types").DashboardPreviewInput) =>
      api.post<import("./types").DashboardPreviewDTO>(`/dashboards/${id}/preview`, body),
    addWidget: (id: string, body: import("./types").WidgetInput) =>
      api.post<import("./types").DashboardWidget>(`/dashboards/${id}/widgets`, body),
    updateWidget: (id: string, widgetId: string, body: import("./types").UpdateWidgetInput) =>
      api.patch<import("./types").DashboardWidget>(`/dashboards/${id}/widgets/${widgetId}`, body),
    deleteWidget: (id: string, widgetId: string) =>
      api.delete<{ deleted: boolean }>(`/dashboards/${id}/widgets/${widgetId}`),
  },
  analytics: {
    metrics: (body: import("./types").MetricsQueryInput) =>
      api.post<import("./types").MetricResultDTO>("/analytics/metrics", body),
    comparePeriods: (body: import("./types").ComparePeriodsInput) =>
      api.post<import("./types").ComparePeriodsResultDTO>("/analytics/compare-periods", body),
    groupBy: (body: import("./types").GroupByInput) =>
      api.post<import("./types").GroupByResultDTO>("/analytics/group-by", body),
    /** The canonical metric catalog; the report builder renders this. */
    metricCatalog: () =>
      api.get<{ metrics: import("./types/reports").MetricDefinition[] }>(
        "/analytics/metric-catalog",
      ),
  },
  dataSources: {
    createExternalDb: (body: import("./types").ExternalDbConnectionInput) =>
      api.post<{ dataSource: import("./types").DataSourceDTO }>("/data-sources/external-db", body),
    listTables: (id: string) =>
      api.get<{ tables: import("./types").ExternalDbTableDTO[] }>(`/data-sources/${id}/tables`),
    updateTableSelection: (id: string, body: import("./types").UpdateTableSelectionInput) =>
      api.patch<{ selectedCount: number }>(`/data-sources/${id}/tables`, body),
    sync: (id: string) =>
      api.post<{ importJobs: import("./types").ImportJobDTO[] }>(`/data-sources/${id}/sync`),
  },
  datasets: {
    list: () =>
      api.get<{
        datasets: Array<{ id: string; name: string; status: string; rowCount: number }>;
      }>("/datasets"),
    get: (datasetId: string) =>
      api.get<import("./types").DatasetDetailDTO>(`/datasets/${datasetId}`),
    /** Latest quality report for a dataset (data-quality health panel). */
    quality: (datasetId: string) =>
      api.get<import("./types").DataQualityReportDTO>(`/datasets/${datasetId}/quality`),
    reimport: (
      datasetId: string,
      input: { commit: "APPEND" | "REPLACE" | "UPSERT"; upsertKey?: string },
      file: File,
    ) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("commit", input.commit);
      if (input.upsertKey) formData.append("upsertKey", input.upsertKey);
      return api.upload<{ import: import("./types").ImportJobDTO }>(
        `/datasets/${datasetId}/re-import`,
        formData,
      );
    },
  },
  imports: {
    list: (params?: { page?: number; pageSize?: number; status?: string }) => {
      const query = new URLSearchParams({
        page: String(params?.page ?? 1),
        pageSize: String(params?.pageSize ?? 20),
      });
      if (params?.status) query.set("status", params.status);
      return api.get<{
        imports: import("./types").ImportJobDTO[];
        meta: { page: number; pageSize: number; total: number; hasMore: boolean };
      }>(`/imports?${query.toString()}`);
    },
  },
  usage: {
    /** Metered consumption for the current billing period. */
    get: (metric: string) =>
      api.get<import("./types").UsageDTO>(
        `/usage?metric=${encodeURIComponent(metric)}`,
      ),
  },
  ai: {
    listConversations: () =>
      api.get<import("./types").ConversationListDTO>("/ai/conversations"),
    createConversation: (body: import("./types").ConversationCreateInput) =>
      api.post<import("./types").ConversationDTO>("/ai/conversations", body),
    getConversation: (id: string) =>
      api.get<import("./types").ConversationDetailDTO>(`/ai/conversations/${id}`),
    runMessage: (id: string, body: import("./types").RunMessageInput) =>
      api.post<import("./types").RunMessageAcceptedDTO>(
        `/ai/conversations/${id}/messages`,
        body,
      ),
    cancelRun: (id: string) =>
      api.post<import("./types").CancelRunDTO>(`/ai/conversations/${id}/cancel`),
    waitForAnswer: (
      id: string,
      options?: { maxAttempts?: number; intervalMs?: number; signal?: AbortSignal },
    ) =>
      pollUntil(
        () => api.get<import("./types").ConversationDetailDTO>(`/ai/conversations/${id}`),
        (data) => data.nextRun === null && data.activeJob === null,
        options,
      ),
    investigations: {
      list: () => api.get<import("./types").InvestigationListDTO>("/ai/investigations"),
      create: (body: import("./types").InvestigationCreateInput) =>
        api.post<import("./types").InvestigationCreateAcceptedDTO>("/ai/investigations", body),
      get: (id: string) =>
        api.get<import("./types").InvestigationDetailDTO>(`/ai/investigations/${id}`),
      waitForCompletion: (
        id: string,
        options?: { maxAttempts?: number; intervalMs?: number; signal?: AbortSignal },
      ) =>
        pollUntil(
          () => api.get<import("./types").InvestigationDetailDTO>(`/ai/investigations/${id}`),
          (data) => data.status !== "RUNNING",
          options,
        ),
    },
    simulations: {
      list: () => api.get<import("./types").SimulationListDTO>("/ai/simulations"),
      create: (body: import("./types").SimulationCreateInput) =>
        api.post<import("./types").SimulationDTO>("/ai/simulations", body),
      createScenario: (simulationId: string, body: import("./types").CreateScenarioInput) =>
        api.post<import("./types").CreateScenarioAcceptedDTO>(
          `/ai/simulations/${simulationId}/scenarios`,
          body,
        ),
      getScenario: (simulationId: string, scenarioId: string) =>
        api.get<import("./types").ScenarioDetailDTO>(
          `/ai/simulations/${simulationId}/scenarios/${scenarioId}`,
        ),
      explain: (simulationId: string, scenarioId: string) =>
        api.post<import("./types").SimulationExplainDTO>(
          `/ai/simulations/${simulationId}/scenarios/${scenarioId}/explain`,
        ),
    },
    mappingSuggestions: {
      list: (params: {
        datasetId?: string;
        importJobId?: string;
        status?: import("./types").MappingSuggestionStatus;
        page?: number;
        perPage?: number;
      }) => {
        const query = new URLSearchParams();
        if (params.datasetId) query.set("datasetId", params.datasetId);
        if (params.importJobId) query.set("importJobId", params.importJobId);
        if (params.status) query.set("status", params.status);
        if (params.page) query.set("page", String(params.page));
        if (params.perPage) query.set("perPage", String(params.perPage));
        const qs = query.toString();
        return api.get<import("./types").MappingSuggestionListDTO>(
          `/ai/mapping-suggestions${qs ? `?${qs}` : ""}`,
        );
      },
      confirm: (id: string) =>
        api.post<{ id: string; status: "CONFIRMED"; columnId?: string; semanticKey?: string; analyticsReady: boolean }>(
          `/ai/mapping-suggestions/${id}/confirm`,
          {},
        ),
      reject: (id: string) =>
        api.post<{ id: string; status: "REJECTED"; analyticsReady: boolean }>(
          `/ai/mapping-suggestions/${id}/reject`,
          {},
        ),
      batch: (body: {
        importJobId: string;
        decisions: import("./types").MappingSuggestionDecision[];
      }) =>
        api.post<{ results: import("./types").MappingBatchResultDTO[] }>(
          "/ai/mapping-suggestions/batch",
          body,
        ),
    },
  },
  anomalyDetections: {
    list: (params?: { status?: string; metricKind?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.status) query.set("status", params.status);
      if (params?.metricKind) query.set("metricKind", params.metricKind);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return api.get<import("./types").AnomalyDetectionListDTO>(
        `/ai/anomalies${qs ? `?${qs}` : ""}`,
      );
    },
    get: (id: string) =>
      api.get<import("./types").AnomalyDetectionDTO>(`/ai/anomalies/${id}`),
    acknowledge: (id: string) =>
      api.patch<import("./types").AnomalyDetectionDTO>(`/ai/anomalies/${id}/acknowledge`, {}),
    resolve: (id: string) =>
      api.patch<import("./types").AnomalyDetectionDTO>(`/ai/anomalies/${id}/resolve`, {}),
  },
  recommendations: {
    generate: () =>
      api.post<{ message: string }>("/ai/recommendations/generate", {}),
    list: (params?: { workspaceId?: string; source?: string; severity?: string; status?: string }) => {
      const query = new URLSearchParams();
      if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
      if (params?.source) query.set("source", params.source);
      if (params?.severity) query.set("severity", params.severity);
      if (params?.status) query.set("status", params.status);
      return api.get<{ recommendations: import("./types/recommendations").Recommendation[] }>(
        `/ai/recommendations${query.toString() ? `?${query.toString()}` : ""}`,
      );
    },
    get: (id: string) =>
      api.get<{ recommendation: import("./types/recommendations").Recommendation }>(`/ai/recommendations/${id}`),
    updateStatus: (id: string, status: string) =>
      api.patch<{ recommendation: import("./types/recommendations").Recommendation }>(`/ai/recommendations/${id}/status`, { status }),
    acknowledge: (id: string) =>
      api.patch<{ recommendation: import("./types/recommendations").Recommendation }>(`/ai/recommendations/${id}/acknowledge`, {}),
    resolve: (id: string) =>
      api.patch<{ recommendation: import("./types/recommendations").Recommendation }>(`/ai/recommendations/${id}/resolve`, {}),
    dismiss: (id: string) =>
      api.patch<{ recommendation: import("./types/recommendations").Recommendation }>(`/ai/recommendations/${id}/dismiss`, {}),
  },
  alertRules: {
    create: (body: import("./types/notifications").CreateAlertRuleInput) =>
      api.post<{ rule: import("./types/notifications").AlertRuleDTO }>("/ai/alert-rules", body).then(r => r.rule),
    list: (params?: { workspaceId?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return api.get<{
        rules: import("./types/notifications").AlertRuleDTO[];
        meta: PageMeta;
      }>(`/ai/alert-rules${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) =>
      api.get<{ rule: import("./types/notifications").AlertRuleDTO }>(`/ai/alert-rules/${id}`).then(r => r.rule),
    update: (id: string, body: import("./types/notifications").UpdateAlertRuleInput) =>
      api.patch<{ rule: import("./types/notifications").AlertRuleDTO }>(`/ai/alert-rules/${id}`, body).then(r => r.rule),
    remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/ai/alert-rules/${id}`),
  },
  alerts: {
    list: (params?: { workspaceId?: string; status?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
      if (params?.status) query.set("status", params.status);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return api.get<{
        alerts: import("./types/notifications").AlertDTO[];
        meta: PageMeta;
      }>(`/ai/alerts${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) =>
      api.get<{ alert: import("./types/notifications").AlertDTO }>(`/ai/alerts/${id}`).then((r) => r.alert),
    updateStatus: (id: string, status: string) =>
      api.patch<{ alert: import("./types/notifications").AlertDTO }>(`/ai/alerts/${id}/status`, { status }).then((r) => r.alert),
  },
  reports: {
    create: (body: import("./types/reports").CreateReportInput) =>
      api.post<{ report: import("./types/reports").ReportDTO }>("/ai/reports", body).then((r) => r.report),
    list: (params?: { workspaceId?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return api.get<{
        reports: import("./types/reports").ReportDTO[];
        meta: PageMeta;
      }>(`/ai/reports${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) =>
      api.get<{ report: import("./types/reports").ReportDTO }>(`/ai/reports/${id}`).then((r) => r.report),
    /**
     * Queues a render and returns the job id. Generation is asynchronous
     * (`202 Accepted`), so the caller polls `reports.get` until the report
     * leaves `DRAFT`.
     */
    generate: (id: string) =>
      api
        .post<{ jobId: string; report: { id: string; status: string } }>(
          `/ai/reports/${id}/generate`,
          {},
        )
        .then((r) => r.jobId),
    /** Streams the PDF to the user's device; never exposes a public URL. */
    downloadPdf: (id: string, title: string) =>
      downloadFile(
        `/ai/reports/${encodeURIComponent(id)}/pdf`,
        `${title.replace(/[^\w.-]+/g, "-") || "report"}.pdf`,
      ),
    remove: (id: string) =>
      api.delete<{ deleted: boolean; id: string }>(`/ai/reports/${id}`),
  },
  reportSchedules: {
    create: (body: import("./types/reports").CreateReportScheduleInput) =>
      api.post<{ schedule: import("./types/reports").ReportScheduleDTO }>("/ai/report-schedules", body).then((r) => r.schedule),
    list: (params?: { workspaceId?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return api.get<{
        schedules: import("./types/reports").ReportScheduleDTO[];
        meta: PageMeta;
      }>(`/ai/report-schedules${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) =>
      api.get<{ schedule: import("./types/reports").ReportScheduleDTO }>(`/ai/report-schedules/${id}`).then((r) => r.schedule),
    update: (id: string, body: import("./types/reports").CreateReportScheduleInput) =>
      api.patch<{ schedule: import("./types/reports").ReportScheduleDTO }>(`/ai/report-schedules/${id}`, body).then((r) => r.schedule),
    remove: (id: string) =>
      api.delete<{ deleted: boolean; id: string }>(`/ai/report-schedules/${id}`),
  },
  notifications: {
    list: () => api.get<{ notifications: import("./types/notifications").NotificationDTO[] }>("/ai/notifications"),
    markRead: (id: string) =>
      api.patch<import("./types/notifications").NotificationDTO>(`/ai/notifications/${id}/read`, {}),
    markAllRead: () =>
      api.patch<import("./types/notifications").NotificationDTO>("/ai/notifications/read-all", {}),
  },
  workspaces: {
    list: () => api.get<{ workspaces: import("./types").WorkspaceDTO[] }>("/workspaces"),
    getFirst: async () => {
      const result = await api.get<{ workspaces: import("./types").WorkspaceDTO[] }>("/workspaces");
      return result.workspaces[0]?.id ?? null;
    },
  },
};

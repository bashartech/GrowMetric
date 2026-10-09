/** The canonical metric keys, mirroring the backend metricKindSchema. */
export type MetricKind =
  | 'REVENUE'
  | 'ORDERS'
  | 'CUSTOMERS'
  | 'EXPENSES'
  | 'PROFIT'
  | 'INVENTORY';

/** A metrics report, or a summary of one investigation. */
export type ReportType = 'METRICS' | 'INVESTIGATION';

export interface MetricDefinition {
  name: string;
  kind: MetricKind;
  aggregation: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
  unit: string;
}

/** Date range + dimension filters, matching the backend reportFiltersSchema. */
export interface ReportFilters {
  dateColumnId?: string;
  dateFrom?: string;
  dateTo?: string;
  dimensions?: Record<string, string>;
}

export interface ReportDTO {
  id: string;
  /** The report type: computed metrics or an investigation summary. */
  reportType: 'METRICS' | 'INVESTIGATION';
  kind: 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  title: string;
  /** The metrics the user selected, empty for an investigation report. */
  metricKeys: MetricKind[] | null;
  filters: ReportFilters | null;
  breakdowns: string[] | null;
  datasetId: string | null;
  investigationId: string | null;
  content: string | null;
  pdfUrl: string | null;
  status: 'DRAFT' | 'GENERATED' | 'FAILED';
  error: string | null;
  generatedById: string | null;
  organizationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportScheduleDTO {
  id: string;
  reportId: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  cron: string | null;
  timezone: string;
  recipients: string[];
  enabled: boolean;
  nextRunAt: string;
  organizationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportInput {
  workspaceId: string;
  kind: 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  title: string;
  reportType?: 'METRICS' | 'INVESTIGATION';
  /** Required for a metrics report; forbidden for an investigation report. */
  metricKeys?: MetricKind[];
  datasetId?: string | null;
  investigationId?: string | null;
  filters?: ReportFilters;
  breakdowns?: string[];
}

export interface CreateReportScheduleInput {
  workspaceId: string;
  reportId: string;
  frequency: string;
  timezone?: string;
  recipients: string[];
  enabled?: boolean;
}

export interface GenerateReportInput {
  reportId: string;
}

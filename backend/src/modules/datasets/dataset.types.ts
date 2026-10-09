import type { ColumnType, DatasetCommit, DatasetKind, MetricKind, WidgetType } from "@prisma/client";

export interface TypedColumnInput {
  name: string;
  type: ColumnType;
  isNullable: boolean;
  ordinalPosition: number;
  semanticKey?: string | null;
  businessMeaning?: string | null;
  representativeSample?: unknown;
}

export interface PendingMappingCandidate {
  semanticKey: string;
  businessMeaning: string;
  confidence: number;
}

export interface PendingMappingInput {
  columnName: string;
  candidates: PendingMappingCandidate[];
}

export interface PendingMappingDTO extends PendingMappingInput {
  datasetColumnId: string;
}

export interface VersionedCell {
  columnName: string;
  columnType: ColumnType;
  value: string | number | boolean | Date | null;
}

export interface QualityInput {
  totalRows: number;
  columnCount: number;
  missingValuePct: number;
  duplicateRowPct: number;
  invalidNumberPct: number;
  invalidDatePct: number;
  numericOutlierCount: number;
  status: "CLEAN" | "WARNINGS" | "ERROR";
  detail: unknown;
}

export interface VersionedDatasetInput {
  organizationId: string;
  workspaceId: string;
  dataSourceId: string;
  datasetName: string;
  datasetKind?: DatasetKind;
  sourceTable?: string;
  source: string;
  commit: DatasetCommit;
  importJobId?: string | null;
  existingDatasetId?: string | null;
  columns: TypedColumnInput[];
  rows: VersionedCell[][];
  quality: QualityInput;
  upsertKeyColumnName?: string | null;
  pendingMappings?: PendingMappingInput[];
}

export interface DataSourceCreateInput {
  name: string;
  kind: "FILE" | "EXTERNAL_DB";
  status?: "NEW" | "CONNECTED" | "FAILED" | "DISABLED";
}

export interface DataSourceSummary {
  id: string;
  name: string;
  kind: string;
  status: string;
  createdAt: string;
}

export interface DataSourceDetail extends DataSourceSummary {
  lastSyncAt: string | null;
  workspaceId: string;
  organizationId: string;
}

export interface ImportSummary {
  id: string;
  filename: string;
  status: string;
  totalRows: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  kind: string;
  status: string;
  rowCount: number;
  currentVersionId: string | null;
  createdAt: string;
}

export interface DatasetColumnDTO {
  id: string;
  name: string;
  type: string;
  ordinalPosition: number;
  semanticKey: string | null;
  businessMeaning: string | null;
  representativeSample?: unknown;
}

export interface DatasetDetail extends DatasetSummary {
  sourceTable: string | null;
  columns: DatasetColumnDTO[];
  pendingMappings: PendingMappingDTO[];
}

export interface DataQualityReportDTO {
  totalRows: number;
  columnCount: number;
  missingValuePct: number;
  duplicateRowPct: number;
  invalidNumberPct: number;
  invalidDatePct: number;
  numericOutlierCount: number;
  status: string;
  detail: unknown;
}

export interface VersionDTO {
  id: string;
  version: number;
  commit: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface WorkspaceDashboard {
  id: string;
  name: string;
  widgetCount: number;
  updatedAt: string;
}

export interface DashboardWidgetDTO {
  id: string;
  type: WidgetType;
  config: unknown;
  position: unknown;
  metricId: string | null;
  datasetId: string | null;
}

export interface BusinessMetricDTO {
  id: string;
  name: string;
  kind: MetricKind;
  definition: unknown;
}

export interface DataSourceTablesDTO {
  tables: { schemaName: string; tableName: string; columnCount: number; rowEstimate: number; isSelected: boolean }[];
}

export interface ExternalDbCreateInput {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode?: string;
}

export interface ExternalDbPatchTablesInput {
  tables: { schemaName: string; tableName: string; isSelected: boolean }[];
}
export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorPayload;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  organizationId: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface OrganizationDTO {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

export interface SubscriptionDTO {
  planKey: string;
  planName: string;
  status: string;
  currentPeriodEnd: string;
}

export interface AuthContextDTO {
  user: UserDTO;
  organization: OrganizationDTO;
  workspace: WorkspaceDTO;
  subscription: SubscriptionDTO;
}

export interface EntitlementsDTO {
  plan: { key: string; name: string };
  features: Record<string, number | boolean>;
  subscription: { status: string; currentPeriodEnd: string } | null;
}

export interface UsageDTO {
  metric: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
}

export interface AuditLogDTO {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: { id: string; name: string } | null;
  workspaceId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedDTO<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// Phase 2: Data Layer DTOs

export interface DataSourceDTO {
  id: string;
  name: string;
  kind: "FILE" | "EXTERNAL_DB";
  status: "NEW" | "CONNECTED" | "VALIDATED" | "FAILED" | "DISABLED";
  lastSyncAt: string | null;
  importCount: number;
  datasetCount: number;
  createdAt: string;
}

export interface ImportJobDTO {
  id: string;
  status: "QUEUED" | "RUNNING" | "REQUESTING_MAPPING" | "COMPLETED" | "FAILED";
  source: "UPLOAD" | "TABLE_SYNC";
  filename: string;
  totalRows: number | null;
  processedRows: number | null;
  error: string | null;
  dataSource: {
    id: string;
    name: string;
    kind: string;
  };
  dataset: {
    id: string;
    name: string;
    status: string;
  } | null;
  datasetId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DatasetDTO {
  id: string;
  name: string;
  kind: "SALES" | "CUSTOMERS" | "PRODUCTS" | "INVENTORY" | "EXPENSES" | "ORDERS" | "CUSTOM";
  status: "DRAFT" | "READY" | "READY_WITH_WARNINGS" | "ERROR";
  rowCount: number;
  currentVersionId: string | null;
  sourceTable: string | null;
  source: "UPLOAD" | "TABLE_SYNC";
  dataSourceId: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface ExternalDbTableDTO {
  id: string;
  schemaName: string;
  tableName: string;
  columnCount: number;
  rowEstimate: number;
  isSelected: boolean;
  syncMode: "REPLACE" | "UPSERT";
  upsertKeyColumnName: string | null;
}

export interface ExternalDbConnectionInput {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: "require" | "prefer" | "disable";
}

export interface UpdateTableSelectionInput {
  tables: Array<{
    schemaName: string;
    tableName: string;
    isSelected: boolean;
    syncMode?: "REPLACE" | "UPSERT";
    upsertKeyColumnName?: string | null;
  }>;
}

export interface DatasetColumnDTO {
  id: string;
  name: string;
  type: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "TIMESTAMP" | "DATE" | "TIME";
  ordinalPosition: number;
  isNullable: boolean;
  semanticKey: string | null;
  businessMeaning: string | null;
  representativeSample?: unknown;
}

export interface PendingMappingCandidateDTO {
  semanticKey: string;
  businessMeaning: string;
  confidence: number;
}

export interface PendingMappingDTO {
  columnName: string;
  datasetColumnId: string;
  candidates: PendingMappingCandidateDTO[];
  source?: "RULES" | "AI";
  agentRunId?: string;
}

export interface DatasetDetailDTO extends DatasetDTO {
  columns: DatasetColumnDTO[];
  pendingMappings: PendingMappingDTO[];
}

export type MappingSuggestionStatus =
  | "PENDING"
  | "CONFIRMED"
  | "REJECTED"
  | "SKIPPED";

export type MappingSuggestionSource = "RULES" | "AI";

export interface MappingSuggestionDTO {
  id: string;
  importJobId: string;
  datasetId: string | null;
  column: {
    id: string;
    name: string;
    type: string;
    representativeSample?: unknown;
  };
  semanticKey: string;
  businessMeaning: string;
  source: MappingSuggestionSource;
  status: MappingSuggestionStatus;
  confidence: number;
  agentRunId: string | null;
  createdAt: string;
}

export interface MappingSuggestionListDTO {
  items: MappingSuggestionDTO[];
  meta: { page: number; perPage: number; total: number };
}

/**
 * Pagination envelope returned alongside every paginated list.
 *
 * `total` is the count for the whole filter, not the page length, so a pager
 * can compute the page count without re-querying.
 */
export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
}

export interface MappingSuggestionDecision {
  suggestionId: string;
  action: "CONFIRM" | "REJECT";
}

export interface MappingBatchResultDTO {
  suggestionId: string;
  action: "CONFIRM" | "REJECT";
  success: boolean;
  status: "CONFIRMED" | "REJECTED" | "FAILED";
  error?: { code: string; message: string };
}

export interface DatasetVersionDTO {
  id: string;
  datasetId: string;
  version: number;
  commit: "APPEND" | "REPLACE" | "UPSERT";
  source: string;
  status: "BUILDING" | "READY";
  summary: unknown;
  createdAt: string;
}

export interface DataQualityReportDTO {
  id: string;
  datasetId: string;
  datasetVersionId: string;
  totalRows: number;
  columnCount: number;
  missingValuePct: number;
  duplicateRowPct: number;
  invalidNumberPct: number;
  invalidDatePct: number;
  numericOutlierCount: number;
  status: "CLEAN" | "WARNINGS" | "ERROR";
  warnings: Array<{
    column: string;
    issue: string;
    severity: string;
  }>;
  createdAt: string;
}

export interface DashboardWidgetDataDTO {
  id: string;
  type: "KPI" | "LINE" | "BAR" | "PIE" | "TABLE";
  title: string;
  data: {
    available: boolean;
    metricKind?: string;
    value?: number | null;
    unit?: string;
    previousValue?: number | null;
    change?: number | null;
    changePct?: number | null;
    changeAvailable?: boolean;
    rows?: Array<{ group: string; value: number }>;
    total?: number;
    spark?: number[];
  };
}

export interface DashboardPreviewDTO {
  id: string;
  name: string;
  widgets: DashboardWidgetDataDTO[];
}

export interface DashboardDTO {
  id: string;
  name: string;
  layout: Record<string, unknown> | null;
  updatedAt: string;
  createdAt: string;
  widgets: Array<{
    id: string;
    type: "KPI" | "LINE" | "BAR" | "PIE" | "TABLE";
    datasetId: string | null;
    config: {
      title?: string;
      metricKind?: string;
      groupBy?: string;
    };
    position: Record<string, unknown>;
  }>;
}

export interface DashboardNameInput {
  name?: string;
  layout?: Record<string, unknown>;
}

export interface WidgetInput {
  type: "KPI" | "LINE" | "BAR" | "PIE" | "TABLE";
  datasetId?: string;
  config?: {
    title?: string;
    metricKind?: "REVENUE" | "ORDERS" | "CUSTOMERS" | "EXPENSES" | "PROFIT" | "INVENTORY";
    groupBy?: string;
  };
  position?: Record<string, unknown>;
}

export interface UpdateWidgetInput {
  config?: {
    title?: string;
    metricKind?: "REVENUE" | "ORDERS" | "CUSTOMERS" | "EXPENSES" | "PROFIT" | "INVENTORY";
    groupBy?: string;
  };
  position?: Record<string, unknown>;
}

export interface DashboardPreviewInput {
  filters?: {
    dateColumnId?: string;
    dateFrom?: string;
    dateTo?: string;
    dimensions?: Record<string, string>;
  };
}

export interface DashboardWidget {
  id: string;
  type: "KPI" | "LINE" | "BAR" | "PIE" | "TABLE";
  datasetId: string | null;
  config: {
    title?: string;
    metricKind?: string;
    groupBy?: string;
  };
  position: Record<string, unknown>;
}

export interface MetricResultDTO {
  metricKind: string;
  value: number | null;
  unit: string;
  available: boolean;
}

export interface ComparePeriodsResultDTO {
  metricKind: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePct: number | null;
  changeAvailable: boolean;
  unit: string;
}

export interface GroupByResultDTO {
  metricKind: string;
  available: boolean;
  rows: Array<{ group: string; value: number }>;
  total: number;
}

export interface MetricFilters {
  dateColumnId?: string;
  dateFrom?: string;
  dateTo?: string;
  dimensions?: Record<string, string>;
}

export interface MetricsQueryInput {
  datasetId: string;
  metricKind: "REVENUE" | "ORDERS" | "CUSTOMERS" | "EXPENSES" | "PROFIT" | "INVENTORY";
  filters?: MetricFilters;
}

export interface ComparePeriodsInput {
  datasetId: string;
  metricKind: "REVENUE" | "ORDERS" | "CUSTOMERS" | "EXPENSES" | "PROFIT" | "INVENTORY";
  dateColumnId: string;
  periodFrom: string;
  periodTo: string;
  filters?: MetricFilters;
}

export interface GroupByInput {
  datasetId: string;
  metricKind: "REVENUE" | "ORDERS" | "CUSTOMERS" | "EXPENSES" | "PROFIT" | "INVENTORY";
  groupByColumnId: string;
  limit?: number;
  filters?: MetricFilters;
}

// Phase 3: AI Analyst DTOs

export type ConversationStatus = "ACTIVE" | "ARCHIVED";
export type ConversationMessageRole = "USER" | "ASSISTANT" | "TOOL";
export type ConversationMessageKind = "CHAT" | "CHART" | "TOOL" | "ERROR";
export type AgentRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";

export interface ConversationSummaryDTO {
  id: string;
  title: string;
  status: ConversationStatus;
  messageCount: number;
  updatedAt: string;
}

export interface ConversationListDTO {
  items: ConversationSummaryDTO[];
  meta: { page: number; perPage: number; total: number };
}

export interface ConversationDTO {
  id: string;
  workspaceId: string;
  title: string;
  kind: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCreateInput {
  title?: string;
}

export interface ConversationRunDTO {
  id: string;
  model: string;
  status: AgentRunStatus;
  latencyMs: number | null;
  steps: number;
  toolsUsed: string[];
}

export interface ConversationMessageDTO {
  id: string;
  role: ConversationMessageRole;
  kind: ConversationMessageKind;
  content: string | null;
  evidenceClass: "CALCULATED" | "INFERRED" | string | null;
  agentRun: ConversationRunDTO | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationDetailDTO {
  id: string;
  title: string;
  kind: string;
  status: ConversationStatus;
  messages: ConversationMessageDTO[];
  nextRun: { runId: string; status: AgentRunStatus; startedAt: string | null } | null;
  // The job exists from message creation onward, before any AgentRun does, so
  // the UI can show Queued/Analyzing during the whole queued window.
  activeJob: { id: string; status: "PENDING" | "RUNNING"; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunMessageInput {
  content: string;
}

export interface RunMessageAcceptedDTO {
  messageId: string;
  status: "QUEUED";
  // Binds this turn's answer: assistant messages persist it in their payload,
  // which is how the client tells its answer apart from any other message.
  jobId: string;
  agentRunId: string | null;
  runStatus: AgentRunStatus;
  conversationId: string;
}

export interface CancelRunDTO {
  runId: string | null;
  status: AgentRunStatus;
}

// Phase 4: AI Investigation DTOs

export type InvestigationStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type FindingLevel = "MAIN" | "SUPPORTING" | "CORRELATION";
export type FindingKind = "DRIVER" | "CONTRIBUTOR" | "ANOMALY";

export interface InvestigationPeriod {
  from: string;
  to: string;
}

export type InvestigationPeriodPreset =
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_12_MONTHS";

export interface MetricChangeDTO {
  metricKey: string;
  value: number | null;
  baselineValue: number | null;
  changePct: number | null;
  periodA: string;
  periodB: string;
}

export interface InvestigationFindingDTO {
  id: string;
  level: FindingLevel;
  kind: FindingKind;
  title: string;
  summary: string;
  metricChange: MetricChangeDTO | null;
  evidence: Record<string, unknown>;
  confidence: number;
  isCausalClaim: boolean;
}

export interface InvestigationListItemDTO {
  id: string;
  title: string;
  question: string;
  topic: string;
  status: InvestigationStatus;
  findingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvestigationListDTO {
  items: InvestigationListItemDTO[];
  meta: { page: number; perPage: number; total: number };
}

export interface InvestigationCreateInput {
  title: string;
  question: string;
  topic: string;
  datasetId?: string;
  periodPreset?: InvestigationPeriodPreset;
  periodTarget?: InvestigationPeriod;
  periodBaseline?: InvestigationPeriod;
}

export interface InvestigationCreateAcceptedDTO {
  id: string;
  status: "RUNNING";
  jobId: string;
  periodTarget: InvestigationPeriod | null;
  periodBaseline: InvestigationPeriod | null;
}

export interface InvestigationRunDTO {
  id: string;
  kind: string;
  status: AgentRunStatus;
  model: string;
  toolsUsed: string[];
}

export interface InvestigationDetailDTO {
  id: string;
  title: string;
  question: string;
  topic: string;
  status: InvestigationStatus;
  datasetId: string | null;
  periodTarget: InvestigationPeriod | null;
  periodBaseline: InvestigationPeriod | null;
  error: string | null;
  agentRun: InvestigationRunDTO | null;
  findings: InvestigationFindingDTO[];
  createdAt: string;
  updatedAt: string;
}

// Phase 5: Simulation DTOs

export type SimulationType =
  | "PRICE_CHANGE"
  | "MARKETING_SPEND"
  | "EXPENSE_REDUCTION"
  | "INVENTORY_CHANGE"
  | "CUSTOM";

export type ScenarioStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "INSUFFICIENT_DATA"
  | "FAILED";

export type SimulationStudyStatus = "ACTIVE" | "ARCHIVED";

export interface SimulationCreateInput {
  name: string;
  datasetId?: string;
}

export interface SimulationDTO {
  id: string;
  name: string;
  datasetId: string | null;
  status: SimulationStudyStatus;
  createdAt: string;
}

export interface SimulationListItemDTO {
  id: string;
  name: string;
  datasetId: string | null;
  status: SimulationStudyStatus;
  scenarioCount: number;
  latestScenarioStatus: ScenarioStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationListDTO {
  items: SimulationListItemDTO[];
  meta: { page: number; perPage: number; total: number };
}

export interface ScenarioAssumptionDTO {
  key: string;
  value: number;
  source: "user";
}

export interface ScenarioResultDTO {
  metricKey: string;
  currentValue: number;
  projectedValue: number;
  changePct: number;
  confidence: number | null;
  isEstimate: boolean;
}

export interface CreateScenarioInput {
  name: string;
  type: SimulationType;
  parameters: Record<string, number>;
  datasetId?: string;
}

export interface CreateScenarioAcceptedDTO {
  id: string;
  simulationId: string;
  name: string;
  type: SimulationType;
  status: "RUNNING";
  jobId: string;
  assumptions: ScenarioAssumptionDTO[];
}

export interface SensitivityAlternativeDTO {
  title: string;
  reason: string;
  suggestion: string;
}

export interface ScenarioExplanationDTO {
  agentRunId: string;
  status: AgentRunStatus;
  content: string;
}

export interface ScenarioDetailDTO {
  id: string;
  simulationId: string;
  name: string;
  type: SimulationType;
  status: ScenarioStatus;
  parameters: Record<string, number>;
  assumptions: ScenarioAssumptionDTO[];
  confidence: number | null;
  results: ScenarioResultDTO[];
  disclaimer: string;
  isEstimate: boolean;
  sensitivityAlternative: SensitivityAlternativeDTO | null;
  modelVersion: string;
  error: string | null;
  explanation: ScenarioExplanationDTO | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationExplainDTO {
  agentRunId: string;
  status: string;
}

export interface AnomalyBaselineDTO {
  period: string;
  value: number;
}

export interface AnomalyObservedDTO {
  period: string;
  value: number;
}

export interface AnomalyDetectionDTO {
  id: string;
  organizationId: string;
  workspaceId: string;
  datasetId: string;
  metricId: string;
  kind: "SPIKE" | "DROP";
  period: string;
  baseline: AnomalyBaselineDTO;
  observed: AnomalyObservedDTO;
  deviationPct: number;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  createdAt: string;
  updatedAt: string;
}

export interface AnomalyDetectionListDTO {
  anomalies: AnomalyDetectionDTO[];
  total: number;
}

// Phase 4: Automation DTOs

export interface RecommendationDTO {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: 'ANOMALY' | 'INVESTIGATION' | 'RULE' | 'SIMULATION' | 'SYSTEM';
  category: string;
  title: string;
  description: string;
  evidence: string;
  suggestedAction?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
  organizationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDTO {
  id: string;
  ruleId: string | null;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  evidence: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  isRead: boolean;
  organizationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleDTO {
  id: string;
  name: string;
  metricKind: string;
  condition: string;
  threshold: number;
  frequency: string;
  recipients: string[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  organizationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDTO {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

// The report DTOs live in ./types/reports so the report builder, the API client
// and the tests all share one definition. Re-exported here because most of the
// app imports from "@/lib/types".
export type {
  ReportDTO,
  ReportScheduleDTO,
  ReportType,
  MetricKind,
  MetricDefinition,
  ReportFilters,
  CreateReportInput,
  CreateReportScheduleInput,
  GenerateReportInput,
} from './types/reports';

export interface ListRecommendationsParams {
  source?: string;
  severity?: string;
  status?: string;
}

export interface UpdateRecommendationStatusParams {
  status: string;
}


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
  condition: 'GREATER_THAN' | 'LESS_THAN' | 'EQUAL_TO' | 'CHANGES_BY';
  threshold: number;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  cron: string | null;
  recipients: string[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  organizationId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertRuleInput {
  workspaceId: string;
  name: string;
  metricKind: string;
  condition: string;
  threshold: number;
  frequency: string;
  recipients: string[];
  datasetId?: string;
}

export interface UpdateAlertRuleInput {
  name?: string;
  condition?: string;
  threshold?: number;
  frequency?: string;
  recipients?: string[];
  enabled?: boolean;
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

export interface UnreadCountDTO {
  recommendations: number;
  alerts: number;
}

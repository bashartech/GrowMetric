export interface Recommendation {
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

export interface ListRecommendationsParams {
  workspaceId: string;
  source?: Recommendation['source'];
  severity?: Recommendation['severity'];
  status?: Recommendation['status'];
}

export interface UpdateRecommendationStatusParams {
  status: Recommendation['status'];
}

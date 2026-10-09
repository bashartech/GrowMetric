'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { Recommendation, ListRecommendationsParams } from '@/lib/types/recommendations';

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<Recommendation['source'] | undefined>();
  const [severityFilter, setSeverityFilter] = useState<Recommendation['severity'] | undefined>();
  const [statusFilter, setStatusFilter] = useState<Recommendation['status'] | undefined>();

  const unreadCount = recommendations.filter(r => r.status === 'OPEN').length;

  const loadWorkspace = useCallback(async () => {
    try {
      const wsId = await api.workspaces.getFirst();
      if (wsId) setWorkspaceId(wsId);
    } catch {
      console.error('Failed to load workspace');
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setLoading(true);
      setError(null);
      const params: ListRecommendationsParams = { workspaceId };
      if (sourceFilter) params.source = sourceFilter;
      if (severityFilter) params.severity = severityFilter;
      if (statusFilter) params.status = statusFilter;

      const result = await api.recommendations.list(params);
      setRecommendations(result.recommendations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, sourceFilter, severityFilter, statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (workspaceId) loadRecommendations(); }, [loadRecommendations, workspaceId]);

  async function handleStatusChange(id: string, status: Recommendation['status']) {
    try {
      await api.recommendations.updateStatus(id, status);
      await loadRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  if (loading) {
    return <div className="p-6">Loading recommendations...</div>;
  }

  if (error) {
    return <div className="p-6 text-[#F87171]">Error: {error}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recommendations</h1>
          <p className="text-muted-foreground mt-1">
            What should you pay attention to or do next?
          </p>
        </div>
        {unreadCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-[rgba(251,146,60,0.18)] text-[#FDBA74] rounded-lg">
            <span className="w-2 h-2 bg-[#FB923C] rounded-full"></span>
            <span className="font-medium">{unreadCount} unread</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 text-white bg-grey-900">
        <select
          value={sourceFilter || ''}
          onChange={(e) => setSourceFilter(e.target.value as Recommendation['source'] || undefined)}
          className="px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring border rounded py-2 border rounded"
        >
          <option value="">All Sources</option>
          <option value="ANOMALY">Anomaly</option>
          <option value="RULE">Alert Rule</option>
          <option value="INVESTIGATION">Investigation</option>
          <option value="SIMULATION">Simulation</option>
          <option value="SYSTEM">System</option>
        </select>

        <select
          value={severityFilter || ''}
          onChange={(e) => setSeverityFilter(e.target.value as Recommendation['severity'] || undefined)}
          className="px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring border rounded border rounded"
        >
          <option value="">All Severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select
          value={statusFilter || ''}
          onChange={(e) => setStatusFilter(e.target.value as Recommendation['status'] || undefined)}
          className="px-3 py-2  rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring border rounded"
        >
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>

      {/* Recommendations List */}
      <div className="space-y-4">
        {recommendations.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No recommendations found. Everything looks good! ✓
          </div>
        ) : (
          recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              onStatusChange={handleStatusChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface RecommendationCardProps {
  recommendation: Recommendation;
  onStatusChange: (id: string, status: Recommendation['status']) => void;
}

function RecommendationCard({ recommendation, onStatusChange }: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(false);

  const severityColors = {
    CRITICAL: 'bg-[rgba(239,68,68,0.15)] text-[#F87171] border-[rgba(239,68,68,0.4)]',
    HIGH: 'bg-[rgba(251,146,60,0.18)] text-[#FDBA74] border-[rgba(251,146,60,0.4)]',
    MEDIUM: 'bg-[rgba(250,204,21,0.14)] text-[#FDE047] border-[rgba(250,204,21,0.4)]',
    LOW: 'bg-[rgba(59,130,246,0.15)] text-[#60A5FA] border-[rgba(59,130,246,0.35)]',
  };

  const sourceLabels = {
    ANOMALY: '📊 Anomaly',
    RULE: '🔔 Alert',
    INVESTIGATION: '🔍 Investigation',
    SIMULATION: '🎯 Simulation',
    SYSTEM: '⚙️ System',
  };

  return (
    <div className={`border rounded-lg p-4 ${severityColors[recommendation.severity]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">{sourceLabels[recommendation.source]}</span>
            <span className="text-xs px-2 py-1 bg-card rounded">{recommendation.severity}</span>
            <span className="text-xs px-2 py-1 bg-card rounded">{recommendation.status}</span>
          </div>
          <h3 className="font-semibold text-lg mb-1">{recommendation.title}</h3>
          <p className="text-sm mb-2">{recommendation.description}</p>

          {recommendation.suggestedAction && (
            <div className="text-sm italic mt-2">
              💡 {recommendation.suggestedAction}
            </div>
          )}

          {expanded && (
            <div className="mt-3 p-3 bg-card rounded text-xs">
              <strong>Evidence:</strong>
              <pre className="mt-1 overflow-x-auto">
                {recommendation.evidence == null
                  ? '—'
                  : typeof recommendation.evidence === 'string'
                    ? recommendation.evidence
                    : JSON.stringify(recommendation.evidence, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 ml-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-3 py-1 text-sm bg-card border rounded hover:bg-muted"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>

          {recommendation.status === 'OPEN' && (
            <>
              <button
                onClick={() => onStatusChange(recommendation.id, 'ACKNOWLEDGED')}
                className="px-3 py-1 text-sm bg-card border rounded hover:bg-muted"
              >
                Acknowledge
              </button>
              <button
                onClick={() => onStatusChange(recommendation.id, 'RESOLVED')}
                className="px-3 py-1 text-sm bg-[var(--success)] text-white rounded hover:bg-[#16A34A]"
              >
                Resolve
              </button>
              <button
                onClick={() => onStatusChange(recommendation.id, 'DISMISSED')}
                className="px-3 py-1 text-sm bg-muted text-foreground border border-border rounded hover:bg-surface-hover"
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

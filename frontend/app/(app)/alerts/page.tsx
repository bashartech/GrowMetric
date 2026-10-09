'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { AlertDTO } from '@/lib/types';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    try {
      const wsId = await api.workspaces.getFirst();
      if (wsId) {
        setWorkspaceId(wsId);
      } else {
        setError('No workspace is available for your account.');
        // Nothing will re-trigger `loadAlerts` (it waits on `workspaceId`),
        // so the spinner has to be cleared here or the page hangs on it.
        setLoading(false);
      }
    } catch (err) {
      console.error('Failed to load workspace');
      setError(err instanceof Error ? err.message : 'Failed to load workspace');
      setLoading(false);
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    // Wait for the workspace rather than firing an unscoped list request: an
    // unfiltered fetch resolves against the tenant's *default* workspace, so it
    // silently shows another workspace's alerts and then re-renders.
    if (!workspaceId) return;
    try {
      const result = await api.alerts.list({ workspaceId });
      setAlerts(result.alerts ?? []);
      setError(null);
    } catch (err) {
      console.error('Failed to load alerts', err);
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    }
    setLoading(false);
  }, [workspaceId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  async function handleStatusChange(id: string, status: string) {
    try {
      await api.alerts.updateStatus(id, status);
      await loadAlerts();
    } catch (err) {
      console.error('Failed to update alert status', err);
      setError(err instanceof Error ? err.message : 'Failed to update alert status');
    }
  }

  if (loading) return <div className="p-6">Loading alerts...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Alerts</h1>
      <div className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-lg border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)] p-4 text-[#F87171]">
            {error}
            <button
              onClick={() => loadAlerts()}
              className="ml-3 px-2 py-1 text-sm border border-[rgba(239,68,68,0.4)] rounded"
            >
              Retry
            </button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No alerts found.</div>
        ) : (
          alerts.map(alert => (
            <div key={alert.id} className={`border rounded-lg p-4 ${alert.severity === 'CRITICAL' ? 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.18)]' : alert.severity === 'HIGH' ? 'border-[rgba(251,146,60,0.4)] bg-[rgba(251,146,60,0.2)]' : 'border-border'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{alert.title}</h3>
                  <p className="text-sm">{alert.message}</p>
                  <span className="text-xs">{alert.severity} — {alert.status}</span>
                </div>
                {alert.status === 'OPEN' && (
                  <button onClick={() => handleStatusChange(alert.id, 'ACKNOWLEDGED')} className="px-3 py-1 text-sm bg-card border rounded">Acknowledge</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

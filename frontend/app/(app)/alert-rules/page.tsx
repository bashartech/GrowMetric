'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { AlertRuleDTO, CreateAlertRuleInput } from '@/lib/types/notifications';

export default function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRuleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateAlertRuleInput>({
    workspaceId: '',
    name: '',
    metricKind: '',
    condition: 'GREATER_THAN',
    threshold: 0,
    frequency: 'DAILY',
    recipients: [],
  });

  const loadWorkspace = useCallback(async () => {
    try {
      const wsId = await api.workspaces.getFirst();
      if (wsId) {
        setWorkspaceId(wsId);
        setForm(f => ({ ...f, workspaceId: wsId }));
      } else {
        setError('No workspace is available for your account.');
      }
    } catch (err) {
      console.error('Failed to load workspace');
      setError(err instanceof Error ? err.message : 'Failed to load workspace');
    }
  }, []);

  const loadRules = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await api.alertRules.list({ workspaceId });
      setRules(result.rules ?? []);
      setError(null);
    } catch (err) {
      console.error('Failed to load alert rules', err);
      setError(err instanceof Error ? err.message : 'Failed to load alert rules');
    }
    setLoading(false);
  }, [workspaceId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadRules(); }, [loadRules, workspaceId]);

  async function handleCreate() {
    if (!workspaceId) return;
    try {
      await api.alertRules.create({ ...form, workspaceId });
      await loadRules();
      setShowForm(false);
    } catch (err) {
      console.error('Failed to create alert rule:', err);
      alert('Failed to create alert rule: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }

  /**
   * Deleting is irreversible and there is no undo, so it is confirmed rather
   * than fired on a single click next to the rule's other controls. The id is
   * captured before the confirm dialog because the list can be refetched while
   * the dialog is open.
   */
  async function handleDelete(rule: AlertRuleDTO) {
    const confirmed = window.confirm(
      `Delete alert rule "${rule.name}"?\n\nThis stops all future alerts from this rule. Alerts it has already raised are kept.`,
    );
    if (!confirmed) return;

    setDeletingId(rule.id);
    try {
      await api.alertRules.remove(rule.id);
      // Drop it locally first so the row disappears even if the refetch fails;
      // an alert rule that is gone should not linger on screen as a ghost.
      setRules(prev => prev.filter(r => r.id !== rule.id));
      await loadRules();
    } catch (err) {
      console.error('Failed to delete alert rule:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete alert rule';
      // `loadRules` clears `error` on success, so the refetch has to happen
      // *before* the failure is surfaced or the message is wiped immediately.
      await loadRules();
      setError(message);
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="p-6">Loading alert rules...</div>;
  if (!workspaceId) return <div className="p-6">Loading workspace...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alert Rules</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded">New Rule</button>
      </div>
      {showForm && (
        <div className="border rounded-lg p-4 space-y-4">
          <input value={form.name} onChange={e => setForm((f: CreateAlertRuleInput) => ({...f, name: e.target.value}))} placeholder="Rule name" className="w-full px-3 py-2 border rounded" />
          <input value={form.metricKind} onChange={e => setForm((f: CreateAlertRuleInput) => ({...f, metricKind: e.target.value}))} placeholder="Metric kind (e.g., REVENUE, ORDERS)" className="w-full px-3 py-2 border rounded" />
          <input type="number" value={form.threshold} onChange={e => setForm((f: CreateAlertRuleInput) => ({...f, threshold: Number(e.target.value)}))} placeholder="Threshold" className="w-full px-3 py-2 border rounded" />
          <select value={form.condition} onChange={e => setForm((f: CreateAlertRuleInput) => ({...f, condition: e.target.value}))} className="px-3 py-2 border rounded bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="GREATER_THAN">Greater Than</option>
            <option value="LESS_THAN">Less Than</option>
            <option value="EQUAL_TO">Equals</option>
            <option value="CHANGES_BY">Changes By</option>
          </select>
          <input
            value={form.recipients.join(', ')}
            onChange={e => {
              const emails = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
              setForm((f: CreateAlertRuleInput) => ({...f, recipients: emails}));
            }}
            placeholder="Recipients (comma-separated emails)"
            className="w-full px-3 py-2 border rounded"
          />
          <button onClick={handleCreate} className="px-4 py-2 bg-[var(--success)] text-white rounded">Save</button>
        </div>
      )}
      <div className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-lg border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)] p-4 text-[#F87171]">
            {error}
            <button
              onClick={() => loadRules()}
              className="ml-3 px-2 py-1 text-sm border border-[rgba(239,68,68,0.4)] rounded"
            >
              Retry
            </button>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No alert rules yet. Create one to start monitoring your metrics.
          </div>
        ) : (
          rules.map(rule => (
            <div key={rule.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{rule.name}</h3>
                  <p className="text-sm text-muted-foreground">{rule.metricKind} {rule.condition} {rule.threshold}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs ${rule.enabled ? 'bg-[rgba(34,197,94,0.15)] text-[#4ADE80]' : 'bg-muted text-foreground'}`}>
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(rule)}
                    disabled={deletingId === rule.id}
                    aria-label={`Delete alert rule ${rule.name}`}
                    className="px-3 py-1 text-sm border border-[rgba(239,68,68,0.4)] text-[#F87171] rounded hover:bg-[rgba(239,68,68,0.15)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deletingId === rule.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { ReportScheduleDTO, CreateReportScheduleInput } from '@/lib/types/reports';

export default function ReportSchedulesPage() {
  const [schedules, setSchedules] = useState<ReportScheduleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateReportScheduleInput>({
    workspaceId: '',
    reportId: '',
    frequency: 'WEEKLY',
    timezone: 'UTC',
    recipients: [],
    enabled: true,
  });
  const [reports, setReports] = useState<{ id: string; title: string }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    try {
      const wsId = await api.workspaces.getFirst();
      if (wsId) {
        setWorkspaceId(wsId);
      }
    } catch {
      console.error('Failed to load workspace');
    }
  }, []);

  const loadReports = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await api.reports.list({ workspaceId });
      setReports((result.reports ?? []).map(r => ({ id: r.id, title: r.title })));
    } catch {
      console.error('Failed to load reports');
    }
  }, [workspaceId]);

  const loadSchedules = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await api.reportSchedules.list({ workspaceId });
      setSchedules(result.schedules ?? []);
    } catch {}
    setLoading(false);
  }, [workspaceId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (workspaceId) loadReports(); }, [loadReports, workspaceId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSchedules(); }, [loadSchedules, workspaceId]);

  async function handleCreate() {
    if (!workspaceId) return;
    try {
      await api.reportSchedules.create({ ...form, workspaceId });
      await loadSchedules();
      setShowForm(false);
    } catch (err) {
      console.error('Failed to create report schedule:', err);
      alert('Failed to create report schedule: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }

  async function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this schedule?')) {
      try {
        setBusyId(id);
        await api.reportSchedules.remove(id);
        await loadSchedules();
        setError(null);
      } catch (err) {
        console.error('Failed to delete schedule:', err);
        setError(err instanceof Error ? err.message : 'Failed to delete schedule');
      } finally {
        setBusyId(null);
      }
    }
  }

  if (loading) return <div className="p-6">Loading report schedules...</div>;
  if (!workspaceId) return <div className="p-6">Loading workspace...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Report Schedules</h1>
        <button onClick={() => { setShowForm(true); loadReports(); }} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded">New Schedule</button>
      </div>
      {showForm && reports.length > 0 && (
        <div className="border rounded-lg p-4 space-y-4">
          <select value={form.reportId} onChange={e => setForm(f => ({...f, reportId: e.target.value}))} className="w-full px-3 py-2 border rounded">
            <option value="">Select a report</option>
            {reports.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <select value={form.frequency} onChange={e => setForm(f => ({...f, frequency: e.target.value}))} className="px-3 py-2 border rounded">
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
          <input value={form.timezone} onChange={e => setForm(f => ({...f, timezone: e.target.value}))} placeholder="Timezone (e.g., UTC, America/New_York)" className="w-full px-3 py-2 border rounded" />
          <input
            value={form.recipients.join(', ')}
            onChange={e => {
              const emails = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
              setForm(f => ({...f, recipients: emails}));
            }}
            placeholder="Recipients (comma-separated emails)"
            className="w-full px-3 py-2 border rounded"
          />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({...f, enabled: e.target.checked}))} />
            <span>Enabled</span>
          </label>
          <button onClick={handleCreate} className="px-4 py-2 bg-[var(--success)] text-white rounded">Save</button>
        </div>
      )}
      {showForm && reports.length === 0 && (
        <div className="text-[#FDE047] p-4 border rounded">Create a report first before scheduling.</div>
      )}
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)] p-4 text-[#F87171]">
            {error}
          </div>
        )}
        {schedules.map(schedule => (
          <div key={schedule.id} className="border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{schedule.frequency} — {schedule.reportId}</h3>
                <p className="text-sm text-muted-foreground">Next run: {new Date(schedule.nextRunAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs ${schedule.enabled ? 'bg-[rgba(34,197,94,0.15)] text-[#4ADE80]' : 'bg-muted text-foreground'}`}>
                  {schedule.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <button
                  onClick={() => handleDelete(schedule.id)}
                  disabled={busyId === schedule.id}
                  className="px-3 py-1 text-sm bg-[var(--destructive)] text-white rounded disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
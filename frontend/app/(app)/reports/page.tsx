'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { dateInputToEndOfDay, dateInputToStartOfDay } from '@/lib/date-filters';
import type { ReportDTO, CreateReportInput, MetricDefinition } from '@/lib/types/reports';

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateReportInput>({
    workspaceId: '',
    kind: 'WEEKLY' as const,
    title: '',
    reportType: 'METRICS',
    metricKeys: [],
  });
  const [catalog, setCatalog] = useState<MetricDefinition[]>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; rowCount: number }>>([]);
  const [investigations, setInvestigations] = useState<Array<{ id: string; title: string }>>([]);

  const selectedMetrics = form.metricKeys ?? [];

  /**
   * Waits for a queued generation to leave `DRAFT`.
   *
   * `POST /reports/:id/generate` only enqueues a job, so the report has to be
   * polled. Bounded so a job that dies in the worker cannot spin the UI
   * forever; the report's own `FAILED` status is surfaced by `loadReports`.
   */
  async function waitForReportSettled(id: string, attempts = 30) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const report = await api.reports.get(id);
      if (report.status !== 'DRAFT') return report;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return api.reports.get(id);
  }

  // The builder cannot render a report that is missing its inputs, so the Create
  // button stays disabled rather than letting the server reject the request.
  const createDisabled =
    form.title.trim() === '' ||
    (form.reportType === 'INVESTIGATION'
      ? !form.investigationId
      : !form.datasetId || selectedMetrics.length === 0);

  // The builder's pickers come from the real dataset/catalog/investigation lists
  // rather than a hardcoded list that would drift from the backend.
  const loadBuilderOptions = useCallback(async () => {
    try {
      const [catalogResult, datasetResult] = await Promise.all([
        api.analytics.metricCatalog(),
        api.datasets.list(),
      ]);
      setCatalog(catalogResult.metrics ?? []);
      setDatasets(datasetResult.datasets ?? []);
    } catch (err) {
      console.error('Failed to load report builder options', err);
      setError(err instanceof Error ? err.message : 'Failed to load report options');
    }
    try {
      const result = await api.ai.investigations.list();
      setInvestigations(
        (result.items ?? []).map(inv => ({ id: inv.id, title: inv.title })),
      );
    } catch {
      // Investigations are optional context for a metrics report; a failure here
      // must not block building one.
    }
  }, []);

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

  const loadReports = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await api.reports.list({ workspaceId });
      setReports(result.reports ?? []);
      setError(null);
    } catch (err) {
      console.error('Failed to load reports', err);
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    }
    setLoading(false);
  }, [workspaceId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (showForm) loadBuilderOptions(); }, [showForm, loadBuilderOptions]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (workspaceId) loadReports(); }, [loadReports, workspaceId]);

async function handleGenerate(id: string) {
   setBusyId(id);
   try {
   // Generation is queued, so the report is still DRAFT when this resolves.
   // Poll until the worker moves it to GENERATED or FAILED rather than
   // assuming the render already happened.
   await api.reports.generate(id);
   await waitForReportSettled(id);
   await loadReports();
   } catch (err) {
   console.error('Failed to generate report', err);
   setError(err instanceof Error ? err.message : 'Failed to generate report');
   } finally {
   setBusyId(null);
   }
   }

  async function handleDownload(report: ReportDTO) {
    setBusyId(report.id);
    try {
      await api.reports.downloadPdf(report.id, report.title);
      setError(null);
    } catch (err) {
      console.error('Failed to download report', err);
      setError(err instanceof Error ? err.message : 'Failed to download report');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    if (!workspaceId || createDisabled) return;
    try {
      await api.reports.create({
        ...form,
        workspaceId,
        metricKeys: form.reportType === 'METRICS' ? selectedMetrics : undefined,
        investigationId: form.reportType === 'INVESTIGATION' ? form.investigationId : null,
      });
      await loadReports();
      setShowForm(false);
      setForm({
        workspaceId,
        kind: 'WEEKLY' as const,
        title: '',
        reportType: 'METRICS',
        metricKeys: [],
      });
      setError(null);
    } catch (err) {
      console.error('Failed to create report:', err);
      setError(err instanceof Error ? err.message : 'Failed to create report');
    }
  }

  async function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this report?')) {
      try {
        setBusyId(id);
        await api.reports.remove(id);
        await loadReports();
        setError(null);
      } catch (err) {
        console.error('Failed to delete report:', err);
        setError(err instanceof Error ? err.message : 'Failed to delete report');
      } finally {
        setBusyId(null);
      }
    }
  }

  if (loading) return <div className="p-6">Loading reports...</div>;
  if (!workspaceId) return <div className="p-6">Loading workspace...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded">New Report</button>
      </div>
      {showForm && (
        <div className="border rounded-lg p-4 space-y-4">
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Report title"
            aria-label="Report title"
            className="w-full px-3 py-2 border rounded"
          />

          <div className="flex gap-2">
            {(['METRICS', 'INVESTIGATION'] as const).map(type => (
              <button
                key={type}
                onClick={() => setForm(f => ({ ...f, reportType: type }))}
                aria-pressed={form.reportType === type}
                className={`px-3 py-2 text-sm border rounded ${
                  form.reportType === type ? 'bg-[rgba(59,130,246,0.18)] text-[#93C5FD]' : ''
                }`}
              >
                {type === 'METRICS' ? 'Metrics report' : 'Investigation report'}
              </button>
            ))}
          </div>

          {form.reportType === 'INVESTIGATION' ? (
            <select
              aria-label="Investigation"
              value={form.investigationId ?? ''}
              onChange={e => setForm(f => ({ ...f, investigationId: e.target.value || null }))}
              className="w-full bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring px-3 py-2 border rounded"
            >
              <option value="">Select an investigation…</option>
              {investigations.map(inv => (
                <option key={inv.id} value={inv.id}>{inv.title}</option>
              ))}
            </select>
          ) : (
            <>
              <select
                aria-label="Dataset"
                value={form.datasetId ?? ''}
                onChange={e => setForm(f => ({ ...f, datasetId: e.target.value || null }))}
                className="w-full px-3 py-2 border rounded bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select a dataset…</option>
                {datasets.map(ds => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} ({ds.rowCount.toLocaleString()} rows)
                  </option>
                ))}
              </select>

              <fieldset className="border rounded p-3">
                <legend className="px-1 text-sm font-medium">Metrics</legend>
                {catalog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Loading metrics…</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {catalog.map(metric => (
                      <label key={metric.kind} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedMetrics.includes(metric.kind)}
                          onChange={e =>
                            setForm(f => {
                              const next = e.target.checked
                                ? [...(f.metricKeys ?? []), metric.kind]
                                : (f.metricKeys ?? []).filter(k => k !== metric.kind);
                              return { ...f, metricKeys: next };
                            })
                          }
                        />
                        {metric.name} <span className="text-muted-foreground/70">({metric.unit})</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <div className="flex gap-2">
                <input
                  type="date"
                  aria-label="From date"
                  value={form.filters?.dateFrom ? form.filters.dateFrom.slice(0, 10) : ''}
                  onChange={e => setForm(f => ({ ...f, filters: { ...f.filters, dateFrom: e.target.value ? dateInputToStartOfDay(e.target.value) : undefined } }))}
                  className="px-3 py-2 border rounded"
                />
                <input
                  type="date"
                  aria-label="To date"
                  value={form.filters?.dateTo ? form.filters.dateTo.slice(0, 10) : ''}
                  onChange={e => setForm(f => ({ ...f, filters: { ...f.filters, dateTo: e.target.value ? dateInputToEndOfDay(e.target.value) : undefined } }))}
                  className="px-3 py-2 border rounded"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <select
              aria-label="Cadence"
              value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value as CreateReportInput['kind'] }))}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring border rounded border rounded"
            >
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="CUSTOM">Custom</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={createDisabled}
              className="px-4 py-2 bg-[var(--success)] text-white rounded disabled:opacity-60"
            >
              Create
            </button>
          </div>
        </div>
      )}
      <div className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-lg border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)] p-4 text-[#F87171]">
            {error}
            <button
              onClick={() => loadReports()}
              className="ml-3 px-2 py-1 text-sm border border-[rgba(239,68,68,0.4)] rounded"
            >
              Retry
            </button>
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No reports yet. Create one above!</div>
        ) : (
          reports.map(report => (
            <div key={report.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{report.title}</h3>
                  <span className="text-sm">{report.kind} — {report.status}</span>
                </div>
                <div className="flex gap-2">
                  {report.status === 'DRAFT' && (
                    <button
                      onClick={() => handleGenerate(report.id)}
                      disabled={busyId === report.id}
                      className="px-3 py-1 text-sm bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded disabled:opacity-60"
                    >
                      {busyId === report.id ? 'Generating…' : 'Generate'}
                    </button>
                  )}
                  {report.status === 'GENERATED' && (
                    <button
                      onClick={() => handleDownload(report)}
                      disabled={busyId === report.id}
                      className="px-3 py-1 text-sm bg-[var(--success)] text-white rounded disabled:opacity-60"
                    >
                      {busyId === report.id ? 'Downloading…' : 'Download PDF'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(report.id)}
                    disabled={busyId === report.id}
                    className="px-3 py-1 text-sm bg-[var(--destructive)] text-white rounded disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
                {report.status === 'FAILED' && report.error && (
                  <p className="mt-2 text-sm text-[#F87171]">{report.error}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface ToolCall {
  id: string;
  name: string;
  sequence: number;
  arguments: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: string;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

interface AgentRun {
  id: string;
  kind: string;
  model: string;
  promptVersion: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: number | null;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  toolsUsed: string[];
  conversationId: string | null;
  investigationId: string | null;
  error: string | null;
  toolCalls: ToolCall[];
}

interface EvidencePanelProps {
  runId: string;
  onClose: () => void;
}

export function EvidencePanel({ runId, onClose }: EvidencePanelProps) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRun() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.get<AgentRun>(`/ai/runs/${runId}`);
        setRun(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
      } finally {
        setLoading(false);
      }
    }
    fetchRun();
  }, [runId]);

  if (loading) {
    return (
      <div className="fixed inset-y-0 right-0 w-96 bg-card shadow-xl border-l border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Evidence</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-muted-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="text-muted-foreground">Loading evidence...</div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="fixed inset-y-0 right-0 w-96 bg-card shadow-xl border-l border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Evidence</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-muted-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="text-[#F87171]">{error || "Run not found"}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card shadow-xl border-l border-border overflow-y-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Evidence</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-muted-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div data-testid="evidence-content">
          {/* Run Header */}
          <div className="mb-6 p-4 bg-muted rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground/80">Status</span>
              <span
                className={`px-2 py-1 text-xs font-semibold rounded ${
                  run.status === "COMPLETED"
                    ? "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]"
                    : run.status === "STOPPED"
                      ? "bg-[rgba(250,204,21,0.14)] text-[#FDE047]"
                      : run.status === "FAILED"
                        ? "bg-[rgba(239,68,68,0.15)] text-[#F87171]"
                        : "bg-muted text-foreground"
                }`}
              >
                {run.status}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground/80">Model</span>
              <span className="text-sm text-foreground">{run.model}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground/80">Latency</span>
              <span className="text-sm text-foreground">
                {run.latencyMs ? `${run.latencyMs.toLocaleString()} ms` : "—"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground/80">Steps</span>
              <span className="text-sm text-foreground">{run.steps} steps</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground/80">Tokens</span>
              <span className="text-sm text-foreground">
                {run.inputTokens.toLocaleString()} in / {run.outputTokens.toLocaleString()} out
              </span>
            </div>

            {run.error && (
              <div className="pt-2 border-t border-border">
                <span className="text-sm font-medium text-foreground/80">Error</span>
                <p className="text-sm text-[#F87171] mt-1">{run.error}</p>
              </div>
            )}
          </div>

          {/* Tool Calls */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Tool Calls ({run.toolCalls.length})
            </h3>
            {run.toolCalls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tool calls recorded</p>
            ) : (
              <div className="space-y-3">
                {run.toolCalls.map((tc) => (
                  <div
                    key={tc.id}
                    className="p-3 border border-border rounded-lg bg-card"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-mono font-medium text-[#818CF8]">
                        {tc.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded ${
                          tc.status === "SUCCESS"
                            ? "bg-[rgba(34,197,94,0.15)] text-[#4ADE80]"
                            : "bg-[rgba(239,68,68,0.15)] text-[#F87171]"
                        }`}
                      >
                        {tc.status}
                      </span>
                    </div>

                    <div className="text-xs text-muted-foreground mb-2">
                      Sequence: {tc.sequence} • Latency: {tc.latencyMs ?? "—"} ms
                    </div>

                    {Object.keys(tc.arguments).length > 0 && (
                      <details className="mb-2">
                        <summary className="text-xs font-medium text-foreground/80 cursor-pointer">
                          Arguments
                        </summary>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(tc.arguments, null, 2)}
                        </pre>
                      </details>
                    )}

                    {tc.output && (
                      <details>
                        <summary className="text-xs font-medium text-foreground/80 cursor-pointer">
                          Output
                        </summary>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(tc.output, null, 2)}
                        </pre>
                      </details>
                    )}

                    {tc.error && (
                      <div className="mt-2 text-xs text-[#F87171]">{tc.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

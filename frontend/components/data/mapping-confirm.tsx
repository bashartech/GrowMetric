"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidencePanel } from "@/components/ai/evidence-panel";
import { api } from "@/lib/api-client";
import type {
  DatasetDetailDTO,
  MappingSuggestionDTO,
  PendingMappingDTO,
} from "@/lib/types";

interface MappingConfirmPanelProps {
  dataset: DatasetDetailDTO;
  onConfirmed: () => void;
}

interface AiSuggestionRowProps {
  suggestion: MappingSuggestionDTO;
  submitting: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onViewEvidence: () => void;
}

const AI_BADGE =
  "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[rgba(139,92,246,0.15)] text-[#A78BFA]";

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const AiSuggestionRow = ({
  suggestion,
  submitting,
  onConfirm,
  onReject,
  onViewEvidence,
}: AiSuggestionRowProps) => (
  <div className="rounded-md border border-[rgba(139,92,246,0.35)] bg-card p-3 space-y-2">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={AI_BADGE}>AI</span>
          <p className="font-medium text-sm truncate">{suggestion.column.name}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {suggestion.column.type}
          {suggestion.column.representativeSample !== undefined &&
            ` · sample: ${String(suggestion.column.representativeSample)}`}
        </p>
      </div>
      <span className="text-sm font-semibold text-[#A78BFA] flex-shrink-0">
        {formatConfidence(suggestion.confidence)}
      </span>
    </div>

    <div className="text-sm">
      <span className="font-medium text-foreground">{suggestion.semanticKey}</span>
      <span className="text-muted-foreground"> — {suggestion.businessMeaning}</span>
    </div>

    <div className="flex items-center gap-2 pt-1">
      <Button size="sm" onClick={onConfirm} disabled={submitting}>
        Confirm
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onReject}
        disabled={submitting}
      >
        Reject
      </Button>
      {suggestion.agentRunId ? (
        <Button size="sm" variant="ghost" onClick={onViewEvidence}>
          View run evidence
        </Button>
      ) : null}
    </div>
  </div>
);

export function MappingConfirmPanel({ dataset, onConfirmed }: MappingConfirmPanelProps) {
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      dataset.pendingMappings.map((pending) => [
        pending.columnName,
        pending.candidates[0]?.semanticKey ?? "",
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [aiItems, setAiItems] = useState<MappingSuggestionDTO[]>([]);
  const [aiLoading, setAiLoading] = useState(dataset.status === "DRAFT");
  const [aiError, setAiError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  const refetchAi = async (): Promise<void> => {
    if (dataset.status !== "DRAFT") return;
    setAiLoading(true);
    setAiError(null);
    try {
      const data = await api.ai.mappingSuggestions.list({
        datasetId: dataset.id,
        status: "PENDING",
        perPage: 100,
      });
      setAiItems(data.items);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to load AI suggestions.");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (dataset.status !== "DRAFT") return;
    let cancelled = false;
    api.ai.mappingSuggestions
      .list({ datasetId: dataset.id, status: "PENDING", perPage: 100 })
      .then((data) => {
        if (!cancelled) setAiItems(data.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAiError(err instanceof Error ? err.message : "Failed to load AI suggestions.");
        }
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset.id, dataset.status]);

  const pendingAi = aiItems.filter((suggestion) => suggestion.status === "PENDING");
  const aiResolved = pendingAi.length === 0;
  const ruleSourcesPending =
    dataset.pendingMappings.filter(
      (pending) => (pending.source ?? "RULES") !== "AI",
    ).length > 0;

  const allResolved = ruleSourcesPending === false && aiResolved;

  if (resolved && allResolved) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.15)] p-3 text-sm text-[#4ADE80]">
        <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Column mappings confirmed</p>
          <p className="text-[#4ADE80] mt-0.5">
            The dataset is now available for analysis.
          </p>
        </div>
      </div>
    );
  }

  const handleRulesConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const candidateByKey = (pending: PendingMappingDTO) =>
        pending.candidates.find(
          (candidate) => candidate.semanticKey === selections[pending.columnName],
        );

      await api.post<{ id: string }>(`/datasets/${dataset.id}/confirm-mapping`, {
        mappings: dataset.pendingMappings.map((pending) => ({
          datasetColumnId: pending.datasetColumnId,
          semanticKey: selections[pending.columnName],
          businessMeaning: candidateByKey(pending)?.businessMeaning ?? "",
        })),
      });
      setResolved(true);
      await refetchAi();
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm mappings.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAi = async (suggestion: MappingSuggestionDTO) => {
    setResolvingId(suggestion.id);
    setAiError(null);
    try {
      await api.ai.mappingSuggestions.confirm(suggestion.id);
      setResolved(true);
      await refetchAi();
      onConfirmed();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to confirm suggestion.");
    } finally {
      setResolvingId(null);
    }
  };

  const handleRejectAi = async (suggestion: MappingSuggestionDTO) => {
    setResolvingId(suggestion.id);
    setAiError(null);
    try {
      await api.ai.mappingSuggestions.reject(suggestion.id);
      setResolved(true);
      await refetchAi();
      onConfirmed();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to reject suggestion.");
    } finally {
      setResolvingId(null);
    }
  };

  const handleBatchAi = async (action: "CONFIRM" | "REJECT") => {
    if (pendingAi.length === 0) return;
    setSubmitting(true);
    setAiError(null);
    try {
      const importJobIds = [...new Set(pendingAi.map((suggestion) => suggestion.importJobId))];
      for (const importJobId of importJobIds) {
        const decisions = pendingAi
          .filter((suggestion) => suggestion.importJobId === importJobId)
          .map((suggestion) => ({ suggestionId: suggestion.id, action }));
        await api.ai.mappingSuggestions.batch({ importJobId, decisions });
      }
      setResolved(true);
      await refetchAi();
      onConfirmed();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to batch resolve suggestions.");
    } finally {
      setSubmitting(false);
    }
  };

  const showRulesSection =
    dataset.pendingMappings.length > 0 &&
    dataset.pendingMappings.some(
      (pending) => (pending.source ?? "RULES") === "RULES",
    );
  const showAiSection = pendingAi.length > 0 || aiLoading;

  if (!showRulesSection && !showAiSection) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-foreground/80">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        No column mappings need confirmation.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.14)] p-4 space-y-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-[#FDE047] mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-[#FDE047]">Review column mappings</h3>
          <p className="text-sm text-[#FDE047] mt-0.5">
            Resolve the pending mappings below before this dataset is ready.
          </p>
        </div>
      </div>

      {showRulesSection && dataset.pendingMappings.length > 0 ? (
        <div className="space-y-3">
          {dataset.pendingMappings.map((pending) => {
            if ((pending.source ?? "RULES") === "AI") return null;
            const column = dataset.columns.find(
              (column) => column.id === pending.datasetColumnId,
            );
            return (
              <div
                key={pending.columnName}
                className="rounded-md border border-[rgba(250,204,21,0.35)] bg-card p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[rgba(250,204,21,0.14)] text-[#FDE047]">
                        RULES
                      </span>
                      <p className="font-medium text-sm truncate">{pending.columnName}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {column?.type ?? "unknown"}
                      {column?.representativeSample !== undefined &&
                        ` · sample: ${String(column.representativeSample)}`}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <label className="sr-only" htmlFor={`mapping-${pending.columnName}`}>
                      Semantic key for {pending.columnName}
                    </label>
                    <select
                      id={`mapping-${pending.columnName}`}
                      value={selections[pending.columnName]}
                      onChange={(event) =>
                        setSelections((previous) => ({
                          ...previous,
                          [pending.columnName]: event.target.value,
                        }))
                      }
                      className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                    >
                      {pending.candidates.map((candidate) => (
                        <option key={candidate.semanticKey} value={candidate.semanticKey}>
                          {candidate.businessMeaning} ({formatConfidence(candidate.confidence)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}

          {error ? <p className="text-sm text-[#F87171]">{error}</p> : null}

          <div className="flex justify-end">
            <Button onClick={handleRulesConfirm} disabled={submitting}>
              {submitting ? "Confirming..." : "Confirm mappings"}
            </Button>
          </div>
        </div>
      ) : null}

      {showAiSection ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#A78BFA]" />
              <h4 className="font-semibold text-sm text-[#A78BFA]">AI suggestions</h4>
              {aiLoading ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
            </div>
            {pendingAi.length > 0 ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleBatchAi("REJECT")}
                  disabled={submitting}
                >
                  Reject all
                </Button>
                <Button size="sm" onClick={() => void handleBatchAi("CONFIRM")} disabled={submitting}>
                  Confirm all
                </Button>
              </div>
            ) : null}
          </div>

          {aiError ? <p className="text-sm text-[#F87171]">{aiError}</p> : null}

          <div className="space-y-2">
            {pendingAi.map((suggestion) => (
              <AiSuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                submitting={resolvingId === suggestion.id}
                onConfirm={() => void handleConfirmAi(suggestion)}
                onReject={() => void handleRejectAi(suggestion)}
                onViewEvidence={() =>
                  suggestion.agentRunId
                    ? setEvidenceRunId(suggestion.agentRunId)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      {evidenceRunId ? (
        <EvidencePanel runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />
      ) : null}
    </div>
  );
}
"use client";

import { useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type Query,
} from "@tanstack/react-query";
import { FlaskConical, Play } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { SimulationForm } from "@/components/ai/simulation-form";
import { SimulationResult } from "@/components/ai/simulation-result";
import type {
  DatasetDTO,
  ScenarioDetailDTO,
  SimulationListItemDTO,
  SimulationType,
} from "@/lib/types";

export default function SimulatorPage() {
  const queryClient = useQueryClient();

  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [studyName, setStudyName] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioType, setScenarioType] = useState<SimulationType>("PRICE_CHANGE");
  const [parameters, setParameters] = useState<Record<string, number>>({});
  const [scenarioDatasetId, setScenarioDatasetId] = useState<string | null>(null);
  const [scenarioIdsByStudy, setScenarioIdsByStudy] = useState<Record<string, string[]>>({});

  const {
    data: datasetsData,
    isLoading: datasetsLoading,
  } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api.get<{ datasets: DatasetDTO[] }>("/datasets"),
  });

  const readyDatasets = useMemo(
    () =>
      (datasetsData?.datasets ?? []).filter(
        (dataset) => dataset.status === "READY" || dataset.status === "READY_WITH_WARNINGS",
      ),
    [datasetsData],
  );

  const selectedDatasetStillReady = readyDatasets.some(
    (dataset) => dataset.id === scenarioDatasetId,
  );
  const effectiveDatasetId =
    scenarioDatasetId && selectedDatasetStillReady ? scenarioDatasetId : (readyDatasets[0]?.id ?? null);

  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: ["ai-simulations"],
    queryFn: () => api.ai.simulations.list(),
  });

  const studies = useMemo<SimulationListItemDTO[]>(
    () => listData?.items ?? [],
    [listData],
  );
  const activeStudyId = selectedStudyId ?? studies[0]?.id ?? null;
  const activeStudy = studies.find((study) => study.id === activeStudyId) ?? null;
  const scenarioIds = scenarioIdsByStudy[activeStudyId ?? ""] ?? [];

  const scenarioQueries = useQueries({
    queries: scenarioIds.map((scenarioId) => ({
      queryKey: ["ai-scenario", activeStudyId, scenarioId],
      queryFn: () =>
        api.ai.simulations.getScenario(activeStudyId as string, scenarioId),
      enabled: activeStudyId !== null,
      refetchInterval: (query: Query) => {
        const data = query.state.data as ScenarioDetailDTO | undefined;
        return data?.status === "RUNNING" ? 2000 : false;
      },
    })),
  });

  const createStudyMutation = useMutation({
    mutationFn: () =>
      api.ai.simulations.create({ name: studyName.trim() }),
    onSuccess: (created) => {
      setStudyName("");
      setSelectedStudyId(created.id);
      void queryClient.invalidateQueries({ queryKey: ["ai-simulations"] });
    },
  });

  const createScenarioMutation = useMutation({
    mutationFn: () =>
      api.ai.simulations.createScenario(activeStudyId as string, {
        name: scenarioName.trim(),
        type: scenarioType,
        parameters,
        datasetId: effectiveDatasetId ?? undefined,
      }),
    onSuccess: (created) => {
      setScenarioName("");
      setParameters({});
      setScenarioIdsByStudy((prev) => ({
        ...prev,
        [created.simulationId]: [...(prev[created.simulationId] ?? []), created.id],
      }));
      void queryClient.invalidateQueries({ queryKey: ["ai-simulations"] });
    },
  });

  const explainMutation = useMutation({
    mutationFn: (scenarioId: string) =>
      api.ai.simulations.explain(activeStudyId as string, scenarioId),
    onSuccess: (_data, scenarioId) => {
      void queryClient.invalidateQueries({
        queryKey: ["ai-scenario", activeStudyId, scenarioId],
      });
    },
  });

  const canCreateStudy = studyName.trim().length > 0;
  const canCreateScenario =
    scenarioName.trim().length > 0 &&
    activeStudyId !== null &&
    effectiveDatasetId !== null &&
    !createScenarioMutation.isPending;

  if (listLoading || datasetsLoading) {
    return <Loading label="Loading studies..." />;
  }
  if (listError) {
    return <ErrorState message={(listError as Error).message} />;
  }

  const createScenarioError = createScenarioMutation.error;
  const isValidationError =
    createScenarioError instanceof ApiError &&
    createScenarioError.code === "VALIDATION_ERROR";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Simulator</h1>
          <p className="text-muted-foreground mt-1">
            Model the impact of decisions against your own data before you commit.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => document.getElementById("sim-study-name")?.focus()}
          disabled={canCreateStudy}
        >
          <FlaskConical className="h-4 w-4" />
          New study
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <label htmlFor="sim-study-name" className="text-sm font-medium">
              Study name
            </label>
            <input
              id="sim-study-name"
              value={studyName}
              onChange={(event) => setStudyName(event.target.value)}
              placeholder="Pricing strategy 2026"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => createStudyMutation.mutate()}
              loading={createStudyMutation.isPending}
              disabled={!canCreateStudy || createStudyMutation.isPending}
            >
              <FlaskConical className="h-4 w-4" />
              Create study
            </Button>
          </div>
        </div>
        {createStudyMutation.isError ? (
          <div
            data-testid="create-study-error"
            className="rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] p-3 text-sm text-[#F87171]"
          >
            {(createStudyMutation.error as Error).message}
          </div>
        ) : null}
      </Card>

      {studies.length === 0 ? (
        <Card className="p-10">
          <EmptyState
            icon={<FlaskConical className="h-12 w-12" />}
            title="No studies yet"
            description="Create a study to run scenarios that project how decisions could change a metric over your own data."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit lg:sticky lg:top-24 max-h-[70vh] overflow-y-auto">
            <div className="p-3">
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Studies
              </p>
              <ul className="space-y-1">
                {studies.map((study) => (
                  <li key={study.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedStudyId(study.id)}
                      className={
                        activeStudyId === study.id
                          ? "w-full rounded-md bg-accent px-3 py-2 text-left text-sm font-medium"
                          : "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                      }
                    >
                      <span className="block truncate">{study.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {study.scenarioCount} scenario
                        {study.scenarioCount === 1 ? "" : "s"}
                        {study.latestScenarioStatus
                          ? ` · ${study.latestScenarioStatus}`
                          : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <div className="space-y-4">
            {activeStudy ? (
              <Card className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{activeStudy.name}</h2>
                  {activeStudy.latestScenarioStatus ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
                      Latest: {activeStudy.latestScenarioStatus}
                    </span>
                  ) : null}
                </div>
                <SimulationForm
                  scenarioName={scenarioName}
                  type={scenarioType}
                  parameters={parameters}
                  datasets={readyDatasets}
                  datasetId={effectiveDatasetId}
                  onScenarioNameChange={setScenarioName}
                  onTypeChange={(value) => {
                    setScenarioType(value);
                    setParameters({});
                  }}
                  onParametersChange={setParameters}
                  onDatasetIdChange={setScenarioDatasetId}
                />
                {isValidationError ? (
                  <div
                    data-testid="create-scenario-error"
                    className="rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] p-3 text-sm text-[#F87171]"
                  >
                    {(createScenarioMutation.error as Error).message}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    onClick={() => createScenarioMutation.mutate()}
                    loading={createScenarioMutation.isPending}
                    disabled={!canCreateScenario}
                    data-testid="run-scenario-button"
                  >
                    <Play className="h-4 w-4" />
                    Run scenario
                  </Button>
                </div>
              </Card>
            ) : null}

            {scenarioIds.length === 0 && activeStudy ? (
              <Card className="p-10">
                <EmptyState
                  icon={<FlaskConical className="h-10 w-10" />}
                  title="No scenarios in this study"
                  description="Run a scenario above and the projection will show here with its recorded assumptions."
                />
              </Card>
            ) : (
              scenarioQueries.map((query, index) => {
                const scenarioId = scenarioIds[index]!;
                if (query.isLoading) {
                  return (
                    <Loading
                      key={scenarioId}
                      label="Loading scenario..."
                    />
                  );
                }
                if (query.error) {
                  return (
                    <ErrorState
                      key={scenarioId}
                      message={(query.error as Error).message}
                    />
                  );
                }
                if (!query.data) return null;
                return (
                  <SimulationResult
                    key={scenarioId}
                    scenario={query.data}
                    onExplain={(id) => explainMutation.mutate(id)}
                    explaining={
                      explainMutation.isPending && explainMutation.variables === scenarioId
                    }
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SimulatorPage from "@/app/(app)/simulator/page";
import type {
  CreateScenarioAcceptedDTO,
  ScenarioDetailDTO,
  SimulationListDTO,
} from "@/lib/types";

const simMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  createScenario: vi.fn(),
  getScenario: vi.fn(),
  explain: vi.fn(),
}));

const datasetsGetMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => {
  class ApiErrorMock extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    constructor(
      status: number,
      error: { code: string; message: string; details?: unknown },
    ) {
      super(error.message);
      this.status = status;
      this.code = error.code;
      this.details = error.details;
    }
  }
  return {
    ApiError: ApiErrorMock,
    api: {
      get: datasetsGetMock,
      ai: { simulations: simMocks },
    },
  };
});

const STUDY_ID = "11111111-1111-1111-1111-111111111111";
const SCENARIO_ID = "22222222-2222-2222-2222-222222222222";
const SALES_DATASET_ID = "33333333-3333-3333-3333-333333333333";

const DATASETS = [
  {
    id: SALES_DATASET_ID,
    name: "Sales_Orders_Demo",
    kind: "SALES" as const,
    status: "READY" as const,
    rowCount: 1200,
    currentVersionId: "v-1",
    sourceTable: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

const listFixture: SimulationListDTO = {
  items: [
    {
      id: STUDY_ID,
      name: "Pricing strategy 2026",
      datasetId: null,
      status: "ACTIVE",
      scenarioCount: 0,
      latestScenarioStatus: null,
      createdAt: "2026-09-20T09:00:00.000Z",
      updatedAt: "2026-09-20T09:00:00.000Z",
    },
  ],
  meta: { page: 1, perPage: 20, total: 1 },
};

const createdFixture: CreateScenarioAcceptedDTO = {
  id: SCENARIO_ID,
  simulationId: STUDY_ID,
  name: "Price +10%",
  type: "PRICE_CHANGE",
  status: "RUNNING",
  jobId: "job-1",
  assumptions: [],
};

const completedFixture: ScenarioDetailDTO = {
  id: SCENARIO_ID,
  simulationId: STUDY_ID,
  name: "Price +10%",
  type: "PRICE_CHANGE",
  status: "COMPLETED",
  parameters: { priceChangePct: 10 },
  assumptions: [],
  confidence: 0.82,
  results: [
    {
      metricKey: "revenue",
      currentValue: 482100.5,
      projectedValue: 508000,
      changePct: 5.38,
      confidence: 0.82,
      isEstimate: true,
    },
  ],
  disclaimer: "Projection — estimate, not a guarantee.",
  isEstimate: true,
  sensitivityAlternative: null,
  modelVersion: "simulation-v1",
  error: null,
  explanation: null,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:05:00.000Z",
};

const insufficientFixture: ScenarioDetailDTO = {
  id: SCENARIO_ID,
  simulationId: STUDY_ID,
  name: "Price +10%",
  type: "PRICE_CHANGE",
  status: "INSUFFICIENT_DATA",
  parameters: { priceChangePct: 10 },
  assumptions: [],
  confidence: null,
  results: [],
  disclaimer: "Projection — estimate, not a guarantee.",
  isEstimate: false,
  sensitivityAlternative: {
    title: "Insufficient data to model revenue",
    reason: "No baseline value is available for the target metric.",
    suggestion: "Connect a dataset with enough history so the model can project.",
  },
  modelVersion: "simulation-v1",
  error: "No baseline value is available for the target metric.",
  explanation: null,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:05:00.000Z",
};

function renderPage() {
  datasetsGetMock.mockResolvedValue({ datasets: DATASETS });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SimulatorPage />
    </QueryClientProvider>,
  );
}

async function createScenarioThroughForm() {
  await screen.findByTestId("simulation-name");
  fireEvent.change(screen.getByTestId("simulation-name"), {
    target: { value: "Price +10%" },
  });
  fireEvent.change(screen.getByTestId("simulation-param-priceChangePct"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByTestId("run-scenario-button"));
}

describe("Simulator page", () => {
  it("shows an honest empty state when no studies exist", async () => {
    simMocks.list.mockResolvedValue({
      items: [],
      meta: { page: 1, perPage: 20, total: 0 },
    });

    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Simulator" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("No studies yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create study" }),
    ).toBeInTheDocument();
  });

  it("runs a scenario against the selected dataset and sends its id", async () => {
    simMocks.list.mockResolvedValue(listFixture);
    simMocks.createScenario.mockResolvedValue(createdFixture);
    simMocks.getScenario.mockResolvedValue(completedFixture);

    renderPage();

    await createScenarioThroughForm();

    expect(simMocks.createScenario).toHaveBeenCalledWith(
      STUDY_ID,
      expect.objectContaining({ datasetId: SALES_DATASET_ID }),
    );
    expect(datasetsGetMock).toHaveBeenCalledWith("/datasets");
    expect(await screen.findByTestId("simulation-result")).toBeInTheDocument();
  });

  it("renders the insufficient-data state with a sensitivity alternative (FR-010)", async () => {
    simMocks.list.mockResolvedValue(listFixture);
    simMocks.createScenario.mockResolvedValue(createdFixture);
    simMocks.getScenario.mockResolvedValue(insufficientFixture);

    renderPage();

    await createScenarioThroughForm();

    expect(await screen.findByTestId("simulation-result")).toBeInTheDocument();
    expect(await screen.findByTestId("sensitivity-alternative")).toBeInTheDocument();
    expect(screen.getByTestId("sensitivity-alternative")).toHaveTextContent(
      /No baseline value/,
    );
    expect(screen.getByTestId("sensitivity-alternative")).toHaveTextContent(
      /Connect a dataset/,
    );
    expect(screen.queryByTestId("simulation-estimate-badge")).not.toBeInTheDocument();
  });

  it("renders a completed projection with disclaimer + estimate badge and explains from recorded values only", async () => {
    simMocks.list.mockResolvedValue(listFixture);
    simMocks.createScenario.mockResolvedValue(createdFixture);
    simMocks.getScenario.mockResolvedValueOnce(completedFixture);
    simMocks.explain.mockResolvedValue({ agentRunId: "run-x", status: "COMPLETED" });

    renderPage();

    await createScenarioThroughForm();

    expect(await screen.findByTestId("simulation-result")).toBeInTheDocument();
    expect(screen.getByTestId("simulation-estimate-badge")).toHaveTextContent(
      "Estimate",
    );
    expect(screen.getByTestId("simulation-disclaimer")).toHaveTextContent(
      "estimate, not a guarantee",
    );

    const row = screen.getByTestId("simulation-result-row");
    expect(row).toHaveTextContent(/revenue/);
    expect(row).toHaveTextContent(/482/);
    expect(row).toHaveTextContent(/\+\s?5\.38/);

    simMocks.getScenario.mockResolvedValue({
      ...completedFixture,
      explanation: {
        agentRunId: "run-x",
        status: "COMPLETED",
        content:
          'Scenario "Price +10%" (price change) with simulation-v1 projects revenue from 482100.5 to 508000 (a 5.38% change) with 0.82 confidence. Projection is an estimate, not a guarantee.',
      },
    });

    fireEvent.click(screen.getByTestId("simulation-explain-button"));

    expect(
      await screen.findByTestId("explanation-content"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("explanation-content")).toHaveTextContent(
      /projects revenue from 482/,
    );
  });

  it("polls a RUNNING scenario and converges when the projection completes", async () => {
    simMocks.list.mockResolvedValue(listFixture);
    simMocks.createScenario.mockResolvedValue(createdFixture);
    simMocks.getScenario.mockResolvedValueOnce({
      ...completedFixture,
      status: "RUNNING",
      results: [],
    });

    renderPage();

    await createScenarioThroughForm();

    expect(
      await screen.findByText("Projection in progress…"),
    ).toBeInTheDocument();

    simMocks.getScenario.mockResolvedValue(completedFixture);

    await waitFor(
      () => {
        expect(screen.getByTestId("simulation-result-row")).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
    expect(simMocks.getScenario.mock.calls.length).toBeGreaterThan(1);
  });
});
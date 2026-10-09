import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InvestigationsPage from "@/app/(app)/investigations/page";
import type {
  InvestigationDetailDTO,
  InvestigationListDTO,
} from "@/lib/types";

const invMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  waitForCompletion: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  investigations: invMocks,
  datasets: { list: vi.fn(), get: vi.fn() },
}));

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
      ai: { investigations: apiMocks.investigations },
      datasets: apiMocks.datasets,
    },
  };
});

const DETAIL_ID = "inv-1";
const DATASET_ID = "11111111-1111-1111-1111-111111111111";

const datasetFixtures = {
  list: {
    datasets: [
      { id: DATASET_ID, name: "Sales", status: "READY", rowCount: 100 },
    ],
  },
  detail: {
    id: DATASET_ID,
    name: "Sales",
    kind: "SALES",
    status: "READY",
    rowCount: 100,
    currentVersionId: "v1",
    sourceTable: null,
    source: "UPLOAD",
    dataSourceId: null,
    lastSyncAt: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    columns: [
      {
        id: "col-date",
        name: "date",
        type: "DATE",
        ordinalPosition: 1,
        isNullable: false,
        semanticKey: "order_date",
        businessMeaning: null,
      },
      {
        id: "col-total",
        name: "total",
        type: "DECIMAL",
        ordinalPosition: 2,
        isNullable: false,
        semanticKey: "revenue",
        businessMeaning: null,
      },
    ],
    pendingMappings: [],
  },
};

const listFixture: InvestigationListDTO = {
  items: [
    {
      id: DETAIL_ID,
      title: "Revenue dip in February",
      question: "Compare the latest period with the one before it.",
      topic: "revenue",
      status: "COMPLETED",
      findingCount: 3,
      createdAt: "2026-09-20T09:00:00.000Z",
      updatedAt: "2026-09-20T09:05:00.000Z",
    },
  ],
  meta: { page: 1, perPage: 20, total: 1 },
};

const detailFixture: InvestigationDetailDTO = {
  id: DETAIL_ID,
  title: "Revenue dip in February",
  question: "Compare the latest period with the one before it.",
  topic: "revenue",
  status: "COMPLETED",
  datasetId: DATASET_ID,
  periodTarget: { from: "2026-01-15T00:00:00.000Z", to: "2026-02-09T23:59:59.999Z" },
  periodBaseline: { from: "2026-01-05T00:00:00.000Z", to: "2026-01-15T23:59:59.999Z" },
  error: null,
  agentRun: {
    id: "run-1",
    kind: "INVESTIGATION",
    status: "COMPLETED",
    model: "investigation-v1",
    toolsUsed: ["run_investigation"],
  },
  findings: [
    {
      id: "f-main",
      level: "MAIN",
      kind: "DRIVER",
      title: "Revenue fell 23.7% in Jan-Feb",
      summary: "Revenue was 2695.3 versus 3531.25. That is a decrease of 23.7%.",
      metricChange: {
        metricKey: "revenue",
        value: 2695.3,
        baselineValue: 3531.25,
        changePct: -23.67,
        periodA: "Jan2026-Feb2026",
        periodB: "Jan2026-Jan2026",
      },
      evidence: {
        datasetId: DATASET_ID,
        metric: "revenue",
        calculation: "SUM(revenue) over Jan2026-Feb2026 vs Jan2026-Jan2026",
        sql: "deterministic aggregation over the mapped value column for each period",
        period: "Jan2026-Feb2026 vs Jan2026-Jan2026",
      },
      confidence: 0.85,
      isCausalClaim: false,
    },
    {
      id: "f-supporting",
      level: "SUPPORTING",
      kind: "CONTRIBUTOR",
      title: 'Region "East" drove a decrease in revenue',
      summary: "Revenue tied to East fell between the periods (delta -100).",
      metricChange: {
        metricKey: "revenue",
        value: 350,
        baselineValue: 500,
        changePct: -30,
        periodA: "Jan2026-Feb2026",
        periodB: "Jan2026-Jan2026",
      },
      evidence: {
        datasetId: DATASET_ID,
        metric: "revenue",
        calculation: "SUM(revenue) grouped by region within each period",
        dimension: "region",
        rank: 1,
      },
      confidence: 0.7,
      isCausalClaim: false,
    },
    {
      id: "f-correlation",
      level: "CORRELATION",
      kind: "ANOMALY",
      title: '"East" shifted from 25% to 35% of revenue',
      summary:
        "This reflects a change in concentration over the period. Correlation is not evidence of cause; the finding is reported with a non-causal label.",
      metricChange: null,
      evidence: {
        datasetId: DATASET_ID,
        metric: "revenue",
        calculation: "share of SUM(revenue) by dimension",
        dimension: "region",
        targetSharePct: 35,
        baselineSharePct: 25,
        shiftPct: 40,
      },
      confidence: 0.5,
      isCausalClaim: false,
    },
  ],
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:05:00.000Z",
};

function renderPage() {
  apiMocks.datasets.list.mockResolvedValue(datasetFixtures.list);
  apiMocks.datasets.get.mockResolvedValue(datasetFixtures.detail);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InvestigationsPage />
    </QueryClientProvider>,
  );
}

describe("Investigations page", () => {
  it("shows an honest empty state when there are no investigations", async () => {
    invMocks.list.mockResolvedValue({
      items: [],
      meta: { page: 1, perPage: 20, total: 0 },
    });

    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Investigations" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("No investigations yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run investigation" }),
    ).toBeInTheDocument();
  });

  it("renders MAIN/SUPPORTING/CORRELATION findings with metric change, evidence, and non-causal label", async () => {
    invMocks.list.mockResolvedValue(listFixture);
    invMocks.get.mockResolvedValue(detailFixture);

    renderPage();

    expect(
      await screen.findByTestId("finding-card-main"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("finding-card-supporting")).toBeInTheDocument();
    expect(screen.getByTestId("finding-card-correlation")).toBeInTheDocument();

    const metricChanges = screen.getAllByTestId("metric-change");
    expect(metricChanges[0]).toHaveTextContent("2,695.3");
    expect(metricChanges[0]).toHaveTextContent("-23.7%");

const evidenceBlocks = screen.getAllByTestId("finding-evidence");
    expect(evidenceBlocks[0]).toHaveTextContent(`dataset ${DATASET_ID}`);

    expect(screen.getByTestId("non-causal-label")).toBeInTheDocument();
    expect(screen.getAllByTestId("non-causal-label")).toHaveLength(1);

    expect(screen.getByTestId("run-badge-completed")).toHaveTextContent(
      "Completed",
    );
  });

  it("polls a RUNNING investigation and converges when the pipeline completes", async () => {
    invMocks.list.mockResolvedValue({
      ...listFixture,
      items: [{ ...listFixture.items[0]!, status: "RUNNING" }],
    });
    const running: InvestigationDetailDTO = {
      ...detailFixture,
      status: "RUNNING",
      findings: [],
      agentRun: {
        id: "run-1",
        kind: "INVESTIGATION",
        status: "RUNNING",
        model: "investigation-v1",
        toolsUsed: [],
      },
    };
    invMocks.get.mockResolvedValueOnce(running);

    renderPage();

    expect(
      await screen.findByText("Investigation in progress…"),
    ).toBeInTheDocument();

    invMocks.get.mockResolvedValue(detailFixture);

    await waitFor(
      () => {
        expect(screen.getByTestId("finding-card-main")).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
    expect(invMocks.get.mock.calls.length).toBeGreaterThan(1);
  });
});
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MappingConfirmPanel } from "@/components/data/mapping-confirm";
import type {
  DatasetDetailDTO,
  MappingSuggestionDTO,
} from "@/lib/types";

const { postMock, listMock, confirmMock, rejectMock, batchMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  listMock: vi.fn(),
  confirmMock: vi.fn(),
  rejectMock: vi.fn(),
  batchMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    post: postMock,
    ai: {
      mappingSuggestions: {
        list: listMock,
        confirm: confirmMock,
        reject: rejectMock,
        batch: batchMock,
      },
    },
  },
}));

const ruleDataset: DatasetDetailDTO = {
  id: "ds-1",
  name: "Customers 2026",
  kind: "CUSTOMERS",
  status: "DRAFT",
  rowCount: 3,
  currentVersionId: "v-1",
  sourceTable: null,
  source: "UPLOAD",
  dataSourceId: null,
  lastSyncAt: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  columns: [
    {
      id: "col-1",
      name: "customer_revenue",
      type: "DECIMAL",
      ordinalPosition: 1,
      isNullable: false,
      semanticKey: "revenue",
      businessMeaning: "Revenue",
      representativeSample: [1200.5, 2300.0],
    },
  ],
  pendingMappings: [
    {
      columnName: "customer_revenue",
      datasetColumnId: "col-1",
      source: "RULES",
      candidates: [
        { semanticKey: "revenue", businessMeaning: "Revenue", confidence: 0.7 },
        { semanticKey: "customers", businessMeaning: "Customers", confidence: 0.7 },
      ],
    },
  ],
};

const aiSuggestion: MappingSuggestionDTO = {
  id: "sg-1",
  importJobId: "ij-1",
  datasetId: "ds-1",
  column: {
    id: "col-2",
    name: "customer_count",
    type: "INTEGER",
    representativeSample: [100, 200],
  },
  semanticKey: "customers",
  businessMeaning: "Customer Count",
  source: "AI",
  status: "PENDING",
  confidence: 0.85,
  agentRunId: "run-123",
  createdAt: "2026-09-01T11:00:00.000Z",
};

const aiDataset: DatasetDetailDTO = {
  ...ruleDataset,
  pendingMappings: [],
  columns: [
    ...ruleDataset.columns,
    {
      id: "col-2",
      name: "customer_count",
      type: "INTEGER",
      ordinalPosition: 2,
      isNullable: false,
      semanticKey: null,
      businessMeaning: null,
    },
  ],
};

describe("MappingConfirmPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({ id: "ds-1", status: "READY" });
    listMock.mockResolvedValue({
      items: [],
      meta: { page: 1, perPage: 100, total: 0 },
    });
    confirmMock.mockResolvedValue({
      id: "sg-1",
      status: "CONFIRMED",
      columnId: "col-2",
      semanticKey: "customers",
      analyticsReady: true,
    });
    rejectMock.mockResolvedValue({
      id: "sg-1",
      status: "REJECTED",
      analyticsReady: false,
    });
    batchMock.mockResolvedValue({
      results: [
        { suggestionId: "sg-1", action: "CONFIRM", success: true, status: "CONFIRMED" },
      ],
    });
  });

  it("renders the review panel for pending RULES columns", async () => {
    render(<MappingConfirmPanel dataset={ruleDataset} onConfirmed={() => {}} />);

    expect(screen.getByText("Review column mappings")).toBeInTheDocument();
    expect(screen.getByText("RULES")).toBeInTheDocument();
    expect(screen.getByText("customer_revenue")).toBeInTheDocument();
    expect(screen.getByText("Revenue (70%)")).toBeInTheDocument();
    expect(screen.getByText("Customers (70%)")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("revenue");
  });

  it("sends the chosen mapping and notifies on success", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    postMock.mockResolvedValueOnce({ id: "ds-1", status: "READY" });

    render(<MappingConfirmPanel dataset={ruleDataset} onConfirmed={onConfirmed} />);

    await user.selectOptions(screen.getByRole("combobox"), "customers");
    await user.click(screen.getByRole("button", { name: "Confirm mappings" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/datasets/ds-1/confirm-mapping", {
        mappings: [
          {
            datasetColumnId: "col-1",
            semanticKey: "customers",
            businessMeaning: "Customers",
          },
        ],
      });
    });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("surfaces API errors on RULES confirm", async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValueOnce(new Error("No mapping is pending"));

    render(<MappingConfirmPanel dataset={ruleDataset} onConfirmed={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Confirm mappings" }));

    expect(await screen.findByText("No mapping is pending")).toBeInTheDocument();
  });

  it("T058: renders AI suggestions with source badge, confidence, and run evidence link", async () => {
    listMock.mockResolvedValue({
      items: [aiSuggestion],
      meta: { page: 1, perPage: 100, total: 1 },
    });

    render(<MappingConfirmPanel dataset={aiDataset} onConfirmed={() => {}} />);

    expect(await screen.findByText("AI suggestions")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("customer_count")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText(/Customer Count/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View run evidence" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm all" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeInTheDocument();
  });

  it("T058: confirms a single AI suggestion", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    listMock.mockResolvedValueOnce({
      items: [aiSuggestion],
      meta: { page: 1, perPage: 100, total: 1 },
    });

    render(<MappingConfirmPanel dataset={aiDataset} onConfirmed={onConfirmed} />);

    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith("sg-1");
    });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("T058: rejects a single AI suggestion", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    listMock.mockResolvedValueOnce({
      items: [aiSuggestion],
      meta: { page: 1, perPage: 100, total: 1 },
    });

    render(<MappingConfirmPanel dataset={aiDataset} onConfirmed={onConfirmed} />);

    await user.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(rejectMock).toHaveBeenCalledWith("sg-1");
    });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("T058: batch-confirms pending AI suggestions grouped by import job", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    listMock.mockResolvedValue(
      Promise.resolve({
        items: [aiSuggestion],
        meta: { page: 1, perPage: 100, total: 1 },
      }),
    );

    render(<MappingConfirmPanel dataset={aiDataset} onConfirmed={onConfirmed} />);

    await user.click(await screen.findByRole("button", { name: "Confirm all" }));

    await waitFor(() => {
      expect(batchMock).toHaveBeenCalledWith({
        importJobId: "ij-1",
        decisions: [{ suggestionId: "sg-1", action: "CONFIRM" }],
      });
    });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("shows an informational state when nothing needs confirming", async () => {
    render(
      <MappingConfirmPanel
        dataset={{ ...ruleDataset, status: "READY", pendingMappings: [] }}
        onConfirmed={() => {}}
      />,
    );

    expect(
      await screen.findByText("No column mappings need confirmation."),
    ).toBeInTheDocument();
  });
});
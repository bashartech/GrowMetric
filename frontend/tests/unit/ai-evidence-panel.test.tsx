import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EvidencePanel } from "@/components/ai/evidence-panel";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  api: {
    get: getMock,
  },
}));

describe("EvidencePanel (T067)", () => {
  it("renders run header with model, tokens, and latency", async () => {
    getMock.mockResolvedValueOnce({
      id: "run-1",
      kind: "ANALYST",
      model: "llama-3.3-70b-versatile",
      status: "COMPLETED",
      steps: 4,
      inputTokens: 1200,
      outputTokens: 310,
      latencyMs: 4210,
      toolsUsed: ["calculate_metric", "group_by_dimension"],
      toolCalls: [
        {
          id: "tc1",
          name: "calculate_metric",
          sequence: 0,
          arguments: { metricKey: "revenue", aggregation: "SUM" },
          output: { value: 482100.5, unit: "USD" },
          status: "SUCCESS",
          latencyMs: 42,
          createdAt: "2026-09-23T10:00:00.000Z",
        },
      ],
      conversationId: "conv-1",
      investigationId: null,
      error: null,
      startedAt: "2026-09-23T10:00:00.000Z",
      completedAt: "2026-09-23T10:00:04.210Z",
      promptVersion: "sha256:1a2b3c",
    });

    render(<EvidencePanel runId="run-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("llama-3.3-70b-versatile")).toBeInTheDocument();
    });
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText(/4,210\s*ms/)).toBeInTheDocument();
    expect(screen.getByText(/1,200/)).toBeInTheDocument();
    expect(screen.getByText(/310/)).toBeInTheDocument();
    expect(screen.getByText(/4\s*steps/)).toBeInTheDocument();
  });

  it("renders tool call list with arguments and output", async () => {
    getMock.mockResolvedValueOnce({
      id: "run-1",
      model: "mock",
      status: "COMPLETED",
      steps: 2,
      inputTokens: 800,
      outputTokens: 200,
      latencyMs: 2000,
      toolsUsed: ["calculate_metric"],
      toolCalls: [
        {
          id: "tc1",
          name: "calculate_metric",
          sequence: 0,
          arguments: { metricKey: "revenue", datasetId: "ds-1" },
          output: { value: 482100.5, unit: "USD" },
          status: "SUCCESS",
          latencyMs: 42,
          createdAt: "2026-09-23T10:00:00.000Z",
        },
        {
          id: "tc2",
          name: "group_by_dimension",
          sequence: 1,
          arguments: { dimension: "region" },
          output: { rows: [{ region: "North", total: 120000 }] },
          status: "SUCCESS",
          latencyMs: 55,
          createdAt: "2026-09-23T10:00:01.000Z",
        },
      ],
      kind: "ANALYST",
      conversationId: "conv-1",
      investigationId: null,
      error: null,
      startedAt: "2026-09-23T10:00:00.000Z",
      completedAt: "2026-09-23T10:00:02.000Z",
      promptVersion: "sha256:1a2b3c",
    });

    render(<EvidencePanel runId="run-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("calculate_metric")).toBeInTheDocument();
    });
    expect(screen.getByText("group_by_dimension")).toBeInTheDocument();

    // Check that tool names and basic data are visible
    const toolCalls = screen.getAllByText(/revenue|region/);
    expect(toolCalls.length).toBeGreaterThan(0);
  });

  it("shows loading state while fetching", () => {
    getMock.mockReturnValueOnce(new Promise(() => {})); // Never resolves

    render(<EvidencePanel runId="run-1" onClose={() => {}} />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    getMock.mockRejectedValueOnce(new Error("Run not found"));

    render(<EvidencePanel runId="run-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/run not found/i)).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    getMock.mockResolvedValueOnce({
      id: "run-1",
      model: "mock",
      status: "COMPLETED",
      steps: 1,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1000,
      toolsUsed: [],
      toolCalls: [],
      kind: "ANALYST",
      conversationId: "conv-1",
      investigationId: null,
      error: null,
      startedAt: "2026-09-23T10:00:00.000Z",
      completedAt: "2026-09-23T10:00:01.000Z",
      promptVersion: "sha256:1a2b3c",
    });

    render(<EvidencePanel runId="run-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    });

    const closeButton = screen.getByRole("button", { name: /close/i });
    await userEvent.setup().click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows STOPPED state with error message", async () => {
    getMock.mockResolvedValueOnce({
      id: "run-1",
      model: "mock",
      status: "STOPPED",
      steps: 5,
      inputTokens: 500,
      outputTokens: 0,
      latencyMs: 3000,
      toolsUsed: ["get_workspace_datasets"],
      toolCalls: [
        {
          id: "tc1",
          name: "get_workspace_datasets",
          sequence: 0,
          arguments: {},
          output: { datasets: [] },
          status: "SUCCESS",
          latencyMs: 20,
          createdAt: "2026-09-23T10:00:00.000Z",
        },
      ],
      kind: "ANALYST",
      conversationId: "conv-1",
      investigationId: null,
      error: "Agent stopped: budget exceeded (max steps reached)",
      startedAt: "2026-09-23T10:00:00.000Z",
      completedAt: "2026-09-23T10:00:03.000Z",
      promptVersion: "sha256:1a2b3c",
    });

    render(<EvidencePanel runId="run-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("STOPPED")).toBeInTheDocument();
    });
    expect(screen.getByText(/budget exceeded/i)).toBeInTheDocument();
  });

  it("does not display credentials in tool I/O", async () => {
    getMock.mockResolvedValueOnce({
      id: "run-1",
      model: "mock",
      status: "COMPLETED",
      steps: 1,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1000,
      toolsUsed: ["get_workspace_datasets"],
      toolCalls: [
        {
          id: "tc1",
          name: "get_workspace_datasets",
          sequence: 0,
          arguments: { workspace: "test" },
          output: { datasets: [{ id: "ds-1", name: "Sales" }] },
          status: "SUCCESS",
          latencyMs: 20,
          createdAt: "2026-09-23T10:00:00.000Z",
        },
      ],
      kind: "ANALYST",
      conversationId: "conv-1",
      investigationId: null,
      error: null,
      startedAt: "2026-09-23T10:00:00.000Z",
      completedAt: "2026-09-23T10:00:01.000Z",
      promptVersion: "sha256:1a2b3c",
    });

    render(<EvidencePanel runId="run-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("get_workspace_datasets")).toBeInTheDocument();
    });

    const content = screen.getByTestId("evidence-content");
    expect(content.textContent).not.toMatch(/password|secret|api_key|gsk_/i);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiAnalystPage from "@/app/(app)/ai-analyst/page";
import type {
  ConversationDetailDTO,
  ConversationListDTO,
  ConversationMessageDTO,
} from "@/lib/types";

const apiMocks = vi.hoisted(() => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  runMessage: vi.fn(),
  createConversation: vi.fn(),
  cancelRun: vi.fn(),
  waitForAnswer: vi.fn(),
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
  return { ApiError: ApiErrorMock, api: { ai: apiMocks } };
});

const userMessage: ConversationMessageDTO = {
  id: "m-user",
  role: "USER",
  kind: "CHAT",
  content: "Which product drove revenue growth last quarter?",
  evidenceClass: null,
  agentRun: null,
  payload: null,
  createdAt: "2026-09-20T09:01:00.000Z",
};

const assistantMessage: ConversationMessageDTO = {
  id: "m-assistant",
  role: "ASSISTANT",
  kind: "CHAT",
  content: "Revenue grew 8.2% and the driver was Widget A.",
  evidenceClass: "CALCULATED",
  agentRun: {
    id: "run-1",
    model: "llama-3.3-70b-versatile",
    status: "COMPLETED",
    latencyMs: 4210,
    steps: 4,
    toolsUsed: ["get_workspace_datasets", "calculate_metric"],
  },
  payload: null,
  createdAt: "2026-09-20T09:04:00.000Z",
};

const conversationFixture: ConversationDetailDTO = {
  id: "convo-1",
  title: "Q3 revenue",
  kind: "ANALYST",
  status: "ACTIVE",
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:05:00.000Z",
  nextRun: null,
  activeJob: null,
  messages: [userMessage, assistantMessage],
};

/**
 * The job is queued (the conversation reports it via `activeJob`) but the
 * worker has not created its AgentRun yet, so `nextRun` is still null. The
 * queued window is exactly what the client used to treat as "idle".
 */
const awaitingRunFixture: ConversationDetailDTO = {
  ...conversationFixture,
  messages: [userMessage],
  nextRun: null,
  activeJob: {
    id: "job-77",
    status: "PENDING",
    createdAt: "2026-09-20T09:01:30.000Z",
  },
};

const listFixture: ConversationListDTO = {
  items: [
    {
      id: "convo-1",
      title: "Q3 revenue",
      status: "ACTIVE",
      messageCount: 2,
      updatedAt: "2026-09-20T09:05:00.000Z",
    },
  ],
  meta: { page: 1, perPage: 20, total: 1 },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiAnalystPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AI Analyst chat thread", () => {
  it("shows an honest empty workspace state when there are no conversations", async () => {
    apiMocks.listConversations.mockResolvedValue({
      items: [],
      meta: { page: 1, perPage: 20, total: 0 },
    });

    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "AI Analyst" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new conversation/i }),
    ).toBeInTheDocument();
  });

  it("renders messages with an evidence badge and completed run state", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    apiMocks.getConversation.mockResolvedValue(conversationFixture);

    renderPage();

    expect(
      await screen.findByText("Which product drove revenue growth last quarter?"),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Revenue grew 8\.2%/)).toBeInTheDocument();
    expect(screen.getByTestId("evidence-badge")).toHaveTextContent(
      "Calculated from your data",
    );
    expect(screen.getByTestId("run-badge-completed")).toHaveTextContent(
      "Completed",
    );
  });

  it("shows the answer without a refresh while the run record does not exist yet", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);

    // Reproduces the real sequence: the first load is idle, then several
    // polls pass with the job queued but no AgentRun, then the answer lands.
    let call = 0;
    apiMocks.getConversation.mockImplementation(async () => {
      call += 1;
      if (call <= 1) return conversationFixture;
      if (call <= 3) return awaitingRunFixture;
      return conversationFixture;
    });
    apiMocks.runMessage.mockResolvedValue({
      messageId: "m-user-2",
      status: "QUEUED",
      jobId: "job-77",
      agentRunId: null,
      runStatus: "PENDING",
      conversationId: "convo-1",
    });

    renderPage();

    await screen.findByText("Which product drove revenue growth last quarter?");

    await userEvent.type(screen.getByLabelText("Message"), "And this quarter?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    // Optimistic feedback: shown immediately rather than after the next poll.
    expect(
      await screen.findByText("Analyzing your data…", undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("run-badge-pending")).toHaveTextContent("Queued");

    // The answer arrives purely through client-side polling.
    await waitFor(
      () => {
        expect(screen.getByText(/Revenue grew 8\.2%/)).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    expect(screen.getByTestId("run-badge-completed")).toBeInTheDocument();
    expect(screen.queryByText("Analyzing your data…")).not.toBeInTheDocument();
    expect(apiMocks.getConversation.mock.calls.length).toBeGreaterThan(3);
  });

  it("waits for the answer bound to this turn's job, not a late answer from another", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);

    const idle: ConversationDetailDTO = {
      ...conversationFixture,
      messages: [userMessage],
      nextRun: null,
      activeJob: null,
    };
    const lateAnswer = {
      ...assistantMessage,
      id: "m-late",
      content: "A stale answer from an earlier turn.",
      payload: { jobId: "job-OLD" },
    };
    const queuedWithLateAnswer: ConversationDetailDTO = {
      ...idle,
      messages: [userMessage, lateAnswer],
      activeJob: {
        id: "job-77",
        status: "PENDING",
        createdAt: "2026-09-20T09:01:30.000Z",
      },
    };
    const answered: ConversationDetailDTO = {
      ...idle,
      messages: [
        userMessage,
        lateAnswer,
        { ...assistantMessage, payload: { jobId: "job-77" } },
      ],
      activeJob: null,
    };

    let call = 0;
    apiMocks.getConversation.mockImplementation(async () => {
      call += 1;
      if (call <= 1) return idle;
      if (call === 2) return queuedWithLateAnswer;
      return answered;
    });
    apiMocks.runMessage.mockResolvedValue({
      messageId: "m-user-2",
      status: "QUEUED",
      jobId: "job-77",
      agentRunId: null,
      runStatus: "PENDING",
      conversationId: "convo-1",
    });

    renderPage();

    await screen.findByText("Which product drove revenue growth last quarter?");
    await userEvent.type(screen.getByLabelText("Message"), "And this quarter?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    // The stale answer arrives while our job is still queued: the watch must
    // not resolve on it.
    expect(
      await screen.findByText("A stale answer from an earlier turn."),
    ).toBeInTheDocument();
    expect(screen.getByText("Analyzing your data…")).toBeInTheDocument();
    expect(screen.getByTestId("run-badge-pending")).toBeInTheDocument();

    // Only the answer carrying this turn's jobId resolves the watch.
    await waitFor(
      () => {
        expect(screen.queryByText("Analyzing your data…")).not.toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    expect(
      screen.getByText(/Revenue grew 8\.2% and the driver was Widget A\./),
    ).toBeInTheDocument();
  });

  it("polls a conversation that was opened while a run was already active", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    const running: ConversationDetailDTO = {
      ...conversationFixture,
      messages: [userMessage],
      nextRun: {
        runId: "run-1",
        status: "RUNNING",
        startedAt: "2026-09-20T09:01:01.000Z",
      },
    };
    let call = 0;
    apiMocks.getConversation.mockImplementation(async () => {
      call += 1;
      return call <= 2 ? running : conversationFixture;
    });

    renderPage();

    await screen.findByText("Which product drove revenue growth last quarter?");
    expect(await screen.findByText("Analyzing your data…")).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByText(/Revenue grew 8\.2%/)).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
  });

  it("surfaces a stopped run without fabricating a conclusion", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    const stopped: ConversationDetailDTO = {
      ...conversationFixture,
      messages: [
        userMessage,
        {
          ...assistantMessage,
          kind: "ERROR",
          content: "Cancelled by user.",
          evidenceClass: null,
          agentRun: { ...assistantMessage.agentRun!, status: "STOPPED" },
        },
      ],
    };
    apiMocks.getConversation.mockResolvedValue(stopped);

    renderPage();

    expect(await screen.findByText("Cancelled by user.")).toBeInTheDocument();
    expect(screen.getByTestId("run-badge-stopped")).toBeInTheDocument();
    expect(screen.queryByTestId("evidence-badge")).not.toBeInTheDocument();
  });

  it("hides tool call lines instead of repeating the run's tool list", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    const withToolCalls: ConversationDetailDTO = {
      ...conversationFixture,
      messages: [
        userMessage,
        // The worker persists one TOOL message per call, each carrying the
        // run's full cumulative tool list.
        ...Array.from({ length: 17 }, (_, index): ConversationMessageDTO => ({
          id: `m-tool-${index}`,
          role: "TOOL",
          kind: "TOOL",
          content: null,
          evidenceClass: null,
          agentRun: {
            id: "run-1",
            model: "llama-3.3-70b-versatile",
            status: "RUNNING",
            latencyMs: null,
            steps: 3,
            toolsUsed: [
              "get_workspace_datasets",
              "get_dataset_schema",
              "calculate_metric",
            ],
          },
          payload: null,
          createdAt: "2026-09-20T09:02:00.000Z",
        })),
        assistantMessage,
      ],
    };
    apiMocks.getConversation.mockResolvedValue(withToolCalls);

    renderPage();

    await screen.findByText(/Revenue grew 8\.2%/);
    expect(screen.queryByText(/^Ran /)).not.toBeInTheDocument();
    expect(screen.queryByText("get_workspace_datasets")).not.toBeInTheDocument();
    expect(screen.queryByText("get_dataset_schema")).not.toBeInTheDocument();
  });

  it("renders markdown formatting rather than raw syntax", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    apiMocks.getConversation.mockResolvedValue({
      ...conversationFixture,
      messages: [
        userMessage,
        {
          ...assistantMessage,
          id: "m-markdown",
          content:
            "Revenue is **$350,325.05** across 120 orders.\n\n- **Protect Software** — top category\n- Grow Electronics — highest per customer\n\n> `order_date` had gaps, so this is a snapshot.",
        },
      ],
    });

    renderPage();

    const strong = await screen.findByText("$350,325.05");
    expect(strong.tagName).toBe("STRONG");

    const bulletLabel = screen.getByText("Protect Software");
    expect(bulletLabel.tagName).toBe("STRONG");
    expect(bulletLabel.closest("li")).not.toBeNull();
    expect(screen.getByText(/Grow Electronics/).closest("li")).not.toBeNull();
    expect(document.querySelector("blockquote")).not.toBeNull();
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
  });

  it("hides inline evidence markers but keeps the single evidence badge", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    apiMocks.getConversation.mockResolvedValue({
      ...conversationFixture,
      messages: [
        userMessage,
        {
          ...assistantMessage,
          id: "m-tagged",
          content:
            "Total revenue is $350,325.05 (CALCULATED) across 120 orders (OBSERVED).\n\n- Protect Software (CALCULATED) leads the portfolio.",
        },
      ],
    });

    renderPage();

    expect(
      await screen.findByText(/Total revenue is \$350,325\.05/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\(CALCULATED\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(OBSERVED\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(INFERRED\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(PROJECTED\)/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("evidence-badge")).toHaveLength(1);
  });

  it("renders no placeholder answer when a run produced no content", async () => {
    apiMocks.listConversations.mockResolvedValue(listFixture);
    apiMocks.getConversation.mockResolvedValue({
      ...conversationFixture,
      messages: [userMessage, { ...assistantMessage, content: null }],
    });

    renderPage();

    await screen.findByText("Which product drove revenue growth last quarter?");
    expect(
      screen.queryByText(/no answer was produced/i),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("run-badge-completed")).toBeInTheDocument();
    });
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AiAnalystPage from "@/app/(app)/ai-analyst/page";

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    readonly status = 500;
    readonly code = "INTERNAL_ERROR";
  },
  api: {
    ai: {
      listConversations: vi.fn().mockResolvedValue({
        items: [],
        meta: { page: 1, perPage: 20, total: 0 },
      }),
      getConversation: vi.fn(),
      runMessage: vi.fn(),
      createConversation: vi.fn(),
      cancelRun: vi.fn(),
      waitForAnswer: vi.fn(),
    },
  },
}));

describe("AI Analyst surface", () => {
  it("renders the analyst landing area", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AiAnalystPage />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "AI Analyst" }),
    ).toBeInTheDocument();
  });
});
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import RecommendationsPage from "@/app/(app)/recommendations/page";
import { mockApi } from "../helpers/mock-api";
import type { Recommendation } from "@/lib/types/recommendations";

const WS = "11111111-1111-4111-8111-111111111111";

const fixture: Recommendation[] = [
  {
    id: "rec-1",
    severity: "HIGH",
    source: "ANOMALY",
    category: "METRIC_DEVIATION",
    title: "Revenue dropped 35% in July",
    description: "Revenue fell sharply versus the prior period.",
    evidence: '{"metricId":"REVENUE","deviationPct":35}',
    suggestedAction: "Review July promotions",
    status: "OPEN",
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "rec-2",
    severity: "MEDIUM",
    source: "RULE",
    category: "ALERT_TRIGGERED",
    title: "Orders threshold exceeded",
    description: "Orders exceeded the configured threshold.",
    evidence: '{"threshold":450}',
    status: "RESOLVED",
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
];

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = mockApi({
    "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
    "/ai/recommendations": ({ url }: { url: string }) => {
      if (url.includes("/rec-1/status")) {
        return { recommendation: { ...fixture[0]!, status: "ACKNOWLEDGED" } };
      }
      return { recommendations: fixture };
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Recommendations page (T105)", () => {
  it("renders the list with severity, source, status and unread badge", async () => {
    render(<RecommendationsPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue dropped 35% in July")).toBeInTheDocument();
    });
    expect(screen.getByText("Orders threshold exceeded")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getAllByText(/Alert/).length).toBeGreaterThan(0);
  });

  it("keeps the recommendations collection shape", async () => {
    render(<RecommendationsPage />);

    await waitFor(() => {
      expect(api.requestsFor("/ai/recommendations").length).toBeGreaterThan(0);
    });
    // Regression guard: the client used to unwrap `recommendations` into a bare
    // array, so `result.recommendations` was undefined and the page stayed empty.
    expect(api.requestsFor("/ai/recommendations")[0]!.url).toContain(
      `workspaceId=${WS}`,
    );
    expect(screen.getByText("Revenue dropped 35% in July")).toBeInTheDocument();
  });

  it("filters by source", async () => {
    render(<RecommendationsPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue dropped 35% in July")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue("All Sources"), {
      target: { value: "ANOMALY" },
    });

    await waitFor(() => {
      const last = api.requestsFor("/ai/recommendations").at(-1)!;
      expect(last.url).toContain("source=ANOMALY");
      expect(last.url).toContain(`workspaceId=${WS}`);
    });
  });

  it("filters by severity", async () => {
    render(<RecommendationsPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue dropped 35% in July")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue("All Severities"), {
      target: { value: "HIGH" },
    });

    await waitFor(() => {
      expect(api.requestsFor("/ai/recommendations").at(-1)!.url).toContain(
        "severity=HIGH",
      );
    });
  });

  it("acknowledges an OPEN recommendation with the acknowledged status transition", async () => {
    render(<RecommendationsPage />);

    await waitFor(() => {
      expect(screen.getByText("Acknowledge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Acknowledge"));

    await waitFor(() => {
      const patch = api
        .requestsFor("/ai/recommendations/rec-1/status")
        .find((r) => r.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.body).toEqual({ status: "ACKNOWLEDGED" });
    });
  });

  it("shows an honest empty state when there are no recommendations", async () => {
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/recommendations": { recommendations: [] },
    });

    render(<RecommendationsPage />);

    await waitFor(() => {
      expect(screen.getByText(/No recommendations found/)).toBeInTheDocument();
    });
  });
});

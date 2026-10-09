import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import AlertsPage from "@/app/(app)/alerts/page";
import { mockApi, status } from "../helpers/mock-api";
import type { AlertDTO } from "@/lib/types";

const WS = "11111111-1111-4111-8111-111111111111";

const fixtures: AlertDTO[] = [
  {
    id: "alert-1",
    ruleId: "rule-1",
    title: "Revenue below floor",
    severity: "HIGH",
    message: "Revenue fell to 82000, under the 100000 floor.",
    evidence: "{}",
    status: "OPEN",
    isRead: false,
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "alert-2",
    ruleId: "rule-2",
    title: "Orders spike",
    severity: "CRITICAL",
    message: "Orders tripled in the last hour.",
    evidence: "{}",
    status: "ACKNOWLEDGED",
    isRead: true,
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
];

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = mockApi({
    "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
    "/ai/alerts": { alerts: fixtures },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api.restore();
});

describe("Alerts page", () => {
  it("renders alerts with their severity and status", async () => {
    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue below floor")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Revenue fell to 82000, under the 100000 floor."),
    ).toBeInTheDocument();
    expect(screen.getByText(/HIGH — OPEN/)).toBeInTheDocument();
    expect(screen.getByText(/CRITICAL — ACKNOWLEDGED/)).toBeInTheDocument();
  });

  /**
   * H1. This page used to call `api.alerts.list(undefined)` before the
   * workspace resolved, firing an unscoped request that the backend answers
   * from the tenant's *default* workspace - so the list briefly showed another
   * workspace's alerts. Every request must carry the resolved workspace.
   */
  it("requests the alert list scoped to the resolved workspace", async () => {
    render(<AlertsPage />);

    await waitFor(() => {
      expect(api.requestsFor("/ai/alerts").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(
        api.requestsFor("/ai/alerts").some((r) => r.url.includes(`workspaceId=${WS}`)),
      ).toBe(true);
    });

    // Not just "at least one scoped call" - never a call without the scope.
    for (const request of api.requestsFor("/ai/alerts")) {
      expect(request.url).toContain(`workspaceId=${WS}`);
    }
  });

  it("acknowledges an open alert and reloads the list", async () => {
    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue below floor")).toBeInTheDocument();
    });

    // Only the OPEN alert offers the action; the acknowledged one does not.
    expect(screen.getAllByRole("button", { name: "Acknowledge" })).toHaveLength(1);

    let acknowledged = false;
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alerts/alert-1/status": () => {
        acknowledged = true;
        return { alert: { ...fixtures[0]!, status: "ACKNOWLEDGED" } };
      },
      "/ai/alerts": {
        alerts: acknowledged
          ? [{ ...fixtures[0]!, status: "ACKNOWLEDGED" as const }]
          : fixtures,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => {
      expect(acknowledged).toBe(true);
    });
    // The status change is a PATCH to the item's own route, not to the
    // collection, and it carries the alert id rather than a query param.
    const statusRequest = api.requestsFor("/ai/alerts/alert-1/status")[0]!;
    expect(statusRequest.method).toBe("PATCH");
    expect(statusRequest.body).toEqual({ status: "ACKNOWLEDGED" });
    // The reload that follows must stay scoped to the workspace.
    await waitFor(() => {
      const reload = api.requestsFor("/ai/alerts").at(-1)!;
      expect(reload.url).toContain(`workspaceId=${WS}`);
    });
  });

  it("shows an error with a retry that refetches the scoped list", async () => {
    let failing = true;
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alerts": () =>
        failing
          ? status(500, { code: "INTERNAL_ERROR", message: "Alerts are unavailable." })
          : { alerts: fixtures },
    });

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Alerts are unavailable.");
    });

    failing = false;
    const before = api.requestsFor("/ai/alerts").length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Revenue below floor")).toBeInTheDocument();
    });
    expect(api.requestsFor("/ai/alerts").length).toBeGreaterThan(before);
  });

  it("surfaces the no-workspace case instead of spinning forever", async () => {
    api = mockApi({
      // A tenant with no workspaces: `getFirst()` resolves null.
      "/workspaces": { workspaces: [] },
      "/ai/alerts": { alerts: fixtures },
    });

    render(<AlertsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No workspace is available for your account."),
      ).toBeInTheDocument();
    });
    // The spinner must not be left up, and no unscoped list may be sent.
    expect(api.requestsFor("/ai/alerts")).toHaveLength(0);
  });

  it("renders an empty state when the workspace has no alerts", async () => {
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alerts": { alerts: [] },
    });

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText("No alerts found.")).toBeInTheDocument();
    });
  });
});
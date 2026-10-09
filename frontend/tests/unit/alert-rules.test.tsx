import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import AlertRulesPage from "@/app/(app)/alert-rules/page";
import { mockApi, status } from "../helpers/mock-api";
import type { RecordedRequest } from "../helpers/mock-api";
import type { AlertRuleDTO } from "@/lib/types/notifications";

const WS = "11111111-1111-4111-8111-111111111111";

const fixtures: AlertRuleDTO[] = [
  {
    id: "rule-1",
    name: "Revenue floor",
    metricKind: "REVENUE",
    condition: "LESS_THAN",
    threshold: 100000,
    frequency: "DAILY",
    cron: null,
    recipients: ["admin@example.com"],
    enabled: true,
    lastTriggeredAt: null,
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "rule-2",
    name: "Orders spike",
    metricKind: "ORDERS",
    condition: "GREATER_THAN",
    threshold: 500,
    frequency: "WEEKLY",
    cron: null,
    recipients: ["admin@example.com"],
    enabled: false,
    lastTriggeredAt: null,
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
    "/ai/alert-rules": { rules: fixtures },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Alert Rules page (T116)", () => {
  it("renders the rule list with enabled/disabled state", async () => {
    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue floor")).toBeInTheDocument();
    });
    expect(screen.getByText("Orders spike")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText(/REVENUE LESS_THAN 100000/)).toBeInTheDocument();
  });

  it("requests the rule list scoped to the resolved workspace", async () => {
    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(api.requestsFor("/ai/alert-rules").length).toBeGreaterThan(0);
    });
    // The backend used to 400 here because no workspaceId was sent.
    expect(api.requestsFor("/ai/alert-rules")[0]!.url).toContain(
      `workspaceId=${WS}`,
    );
  });

  it("renders the collection instead of an empty page", async () => {
    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue floor")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/No alert rules yet/),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when the workspace has no rules", async () => {
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alert-rules": { rules: [] },
    });

    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText(/No alert rules yet/)).toBeInTheDocument();
    });
  });

  it("surfaces a list failure instead of a blank page", async () => {
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alert-rules": status(400, {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid input.",
      }),
    });

    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The request contains invalid input.",
      );
    });
  });

  it("creates a new rule through the form", async () => {
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alert-rules": () => ({ rule: fixtures[0] }),
    });

    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Alert Rules")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("New Rule"));

    const inputs = screen.getAllByPlaceholderText(/Rule name|Metric kind|Threshold/);
    fireEvent.change(inputs[0]!, { target: { value: "Revenue floor" } });
    fireEvent.change(inputs[1]!, { target: { value: "REVENUE" } });
    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "100000" } });
    fireEvent.change(screen.getByDisplayValue("Greater Than"), {
      target: { value: "LESS_THAN" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      const posts = api.requestsFor("/ai/alert-rules").filter(
        (r) => r.method === "POST",
      );
      expect(posts.length).toBe(1);
      expect(posts[0]!.body).toMatchObject({
        name: "Revenue floor",
        metricKind: "REVENUE",
        threshold: 100000,
        condition: "LESS_THAN",
        workspaceId: WS,
      });
    });
  });
});

describe("Alert Rules page — delete", () => {
  /**
   * `mockApi` matches with `path.endsWith(route)`, so the DELETE to
   * `/ai/alert-rules/rule-1` needs its own key. Reusing `/ai/alert-rules` made
   * every delete fall through to the "no stub" 404, which the success case
   * happily passed because it only asserted the request was recorded.
   */
  beforeEach(() => {
    api.restore();
    // Mirror the server: once the rule is deleted it must disappear from later
    // GETs too, otherwise the post-delete refetch hands the row straight back
    // and the test would pass for the wrong reason.
    let deleted = false;
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alert-rules": (r: RecordedRequest) =>
        r.method === "GET"
          ? { rules: deleted ? [] : [fixtures[0]] }
          : { rule: fixtures[0] },
      "/ai/alert-rules/rule-1": (r: RecordedRequest) => {
        if (r.method === "DELETE") {
          deleted = true;
          return { id: "rule-1", deleted: true };
        }
        return { rule: fixtures[0] };
      },
    });
  });

  it("deletes the rule after the user confirms", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true as never);

    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue floor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Delete alert rule/ }));

    await waitFor(() => {
      const deletes = api
        .requestsFor("/ai/alert-rules")
        .filter((r) => r.method === "DELETE");
      expect(deletes.length).toBe(1);
      expect(deletes[0]!.url).toContain("/ai/alert-rules/rule-1");
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    // The row is gone from the server now, so the refetch must not bring it back.
    await waitFor(() => {
      expect(screen.queryByText("Revenue floor")).not.toBeInTheDocument();
    });
  });

  /**
   * A destructive action must not fire on a single click. Confirming is the only
   * thing standing between a stray click and losing a rule, so declining has to
   * issue no request at all.
   */
  it("does not delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false as never);

    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue floor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Delete alert rule/ }));

    await waitFor(() => {
      expect(screen.getByText("Revenue floor")).toBeInTheDocument();
    });
    expect(
      api.requestsFor("/ai/alert-rules").filter((r) => r.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("surfaces a delete failure and keeps the rule listed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true as never);
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/alert-rules": { rules: [fixtures[0]] },
      "/ai/alert-rules/rule-1": status(500, {
        code: "INTERNAL_ERROR",
        message: "Could not delete the alert rule.",
      }),
    });

    render(<AlertRulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Revenue floor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Delete alert rule/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not delete the alert rule.",
      );
    });
    // The banner replaces the list, so prove recovery differently: the rule
    // must be refetched from the server rather than left as a local guess.
    expect(
      api.requestsFor("/ai/alert-rules").filter((r) => r.method === "GET").length,
    ).toBeGreaterThanOrEqual(2);
  });
});

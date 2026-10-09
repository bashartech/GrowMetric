import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import ReportsPage from "@/app/(app)/reports/page";
import { mockApi, status, binary } from "../helpers/mock-api";
import type { ReportDTO } from "@/lib/types";

const WS = "11111111-1111-4111-8111-111111111111";

const fixtures: ReportDTO[] = [
  {
    id: "report-1",
    reportType: "METRICS",
    kind: "WEEKLY",
    title: "Weekly Revenue Report",
    metricKeys: ["REVENUE", "ORDERS"],
    filters: null,
    breakdowns: null,
    datasetId: "dataset-1",
    investigationId: null,
    content: null,
    pdfUrl: null,
    status: "DRAFT",
    error: null,
    generatedById: null,
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "report-2",
    reportType: "METRICS",
    kind: "MONTHLY",
    title: "Monthly Orders Report",
    metricKeys: ["ORDERS"],
    filters: null,
    breakdowns: null,
    datasetId: "dataset-1",
    investigationId: null,
    content: "{}",
    pdfUrl: "org-1/reports/report-2.pdf",
    status: "GENERATED",
    error: null,
    generatedById: null,
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
];

const CATALOG = [
  { name: "Revenue", kind: "REVENUE", aggregation: "SUM", unit: "USD" },
  { name: "Orders", kind: "ORDERS", aggregation: "COUNT", unit: "orders" },
] as const;

const DATASETS = [{ id: "dataset-1", name: "Sales", status: "READY", rowCount: 1200 }];

/** Every route the builder needs, so each test only overrides what it asserts on. */
function builderRoutes(overrides: Record<string, unknown> = {}) {
  return {
    "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
    "/analytics/metric-catalog": { metrics: [...CATALOG] },
    "/datasets": { datasets: [...DATASETS] },
    "/ai/investigations": { items: [{ id: "inv-1", title: "Q3 revenue drop" }] },
    "/ai/reports": { reports: fixtures },
    ...overrides,
  };
}

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = mockApi(builderRoutes());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Reports page (T130)", () => {
  it("renders the report list with status and a download action", async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText("Weekly Revenue Report")).toBeInTheDocument();
    });
    expect(screen.getByText("Monthly Orders Report")).toBeInTheDocument();
    expect(screen.getByText(/WEEKLY — DRAFT/)).toBeInTheDocument();
    expect(screen.getByText(/MONTHLY — GENERATED/)).toBeInTheDocument();

    // A generated report offers a download action; it is no longer a link to a
    // public /uploads path, which 404s and would leak the storage location.
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PDF" })).not.toBeInTheDocument();
  });

  it("requests the report list scoped to the resolved workspace", async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(api.requestsFor("/ai/reports").length).toBeGreaterThan(0);
    });
    const listRequest = api.requestsFor("/ai/reports")[0]!;
    expect(listRequest.url).toContain(`workspaceId=${WS}`);
  });

  it("keeps the collection shape so a list payload is not unwrapped to an array", async () => {
    render(<ReportsPage />);

    // Regression guard: the client used to return `data.reports` (an array),
    // which made `result.reports` undefined and the page render as empty.
    await waitFor(() => {
      expect(screen.getByText("Weekly Revenue Report")).toBeInTheDocument();
    });
    expect(screen.queryByText("No reports yet. Create one above!")).not.toBeInTheDocument();
  });

  it("surfaces a list failure instead of pretending there are no reports", async () => {
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/reports": status(400, {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid input.",
      }),
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The request contains invalid input.",
      );
    });
    expect(screen.queryByText("No reports yet. Create one above!")).not.toBeInTheDocument();
  });

  it("shows an empty state when the workspace has no reports", async () => {
    api.restore();
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/reports": { reports: [] },
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText("No reports yet. Create one above!")).toBeInTheDocument();
    });
  });

  it("downloads the PDF through the API instead of linking a public URL", async () => {
    const generated = { ...fixtures[1]! };
    api.restore();
    api = mockApi(builderRoutes({
      "/ai/reports": { reports: [generated] },
      "/ai/reports/report-2/pdf": binary("%PDF-1.4 test", "application/pdf"),
    }));

    const createObjectUrl = vi.fn(() => "blob:report-pdf");
    // Assign the statics rather than replacing the global URL, which the mock
    // helper needs for `new URL(...)`.
    Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ReportsPage />);

    const button = await screen.findByRole("button", { name: "Download PDF" });
    fireEvent.click(button);

    await waitFor(() => {
      // Must hit the authenticated route, not the old /uploads path.
      expect(api.requestsFor(`/ai/reports/${generated.id}/pdf`).length).toBe(1);
    });
    expect(click).toHaveBeenCalled();
    // The blob is created and handed to a synthetic anchor for download.
    expect(createObjectUrl).toHaveBeenCalled();
    expect(api.requests.some((r) => r.url.includes("/uploads/"))).toBe(false);
  });

  it("surfaces a download failure instead of silently doing nothing", async () => {
    api.restore();
    api = mockApi(builderRoutes({
      "/ai/reports/report-2/pdf": status(404, {
        code: "NOT_FOUND",
        message: "The stored PDF is no longer available. Generate the report again.",
      }),
    }));

    render(<ReportsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The stored PDF is no longer available",
      );
    });
  });

  it("sends the user's selected metrics, dataset and filters when creating", async () => {
    render(<ReportsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New Report" }));
    fireEvent.change(await screen.findByLabelText("Report title"), {
      target: { value: "Q3 Revenue" },
    });
    fireEvent.change(await screen.findByLabelText("Dataset"), {
      target: { value: "dataset-1" },
    });
    fireEvent.click(await screen.findByLabelText(/Revenue/));
    fireEvent.click(await screen.findByLabelText(/Orders/));
    fireEvent.change(await screen.findByLabelText("From date"), {
      target: { value: "2026-07-01" },
    });

    const create = screen.getByRole("button", { name: "Create" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => {
      expect(
        api.requests.some((r) => r.method === "POST" && r.url.endsWith("/ai/reports")),
      ).toBe(true);
    });

    const post = api.requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/ai/reports"),
    )!;
    expect(post.body).toMatchObject({
      workspaceId: WS,
      title: "Q3 Revenue",
      reportType: "METRICS",
      datasetId: "dataset-1",
      metricKeys: ["REVENUE", "ORDERS"],
    });
    expect((post.body as { filters?: { dateFrom?: string } }).filters?.dateFrom).toContain(
      "2026-07-01",
    );
  });

  it("covers the whole final day when a To date is picked", async () => {
    render(<ReportsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New Report" }));
    fireEvent.change(await screen.findByLabelText("Report title"), {
      target: { value: "Q3 Revenue" },
    });
    fireEvent.change(await screen.findByLabelText("Dataset"), {
      target: { value: "dataset-1" },
    });
    fireEvent.click(await screen.findByLabelText(/Revenue/));
    fireEvent.change(await screen.findByLabelText("From date"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(await screen.findByLabelText("To date"), {
      target: { value: "2026-07-31" },
    });

    const create = screen.getByRole("button", { name: "Create" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => {
      expect(
        api.requests.some((r) => r.method === "POST" && r.url.endsWith("/ai/reports")),
      ).toBe(true);
    });

    const post = api.requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/ai/reports"),
    )!;
    const filters = (post.body as { filters?: { dateFrom?: string; dateTo?: string } })
      .filters;

    // The range predicate is inclusive, so the upper bound must be the last
    // instant of the day. UTC midnight would silently drop all of 31 July.
    expect(filters?.dateFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(filters?.dateTo).toBe("2026-07-31T23:59:59.999Z");
  });

  it("keeps Create disabled until the report has a dataset and at least one metric", async () => {
    render(<ReportsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New Report" }));
    const create = await screen.findByRole("button", { name: "Create" });

    // No title yet.
    expect(create).toBeDisabled();

    fireEvent.change(await screen.findByLabelText("Report title"), {
      target: { value: "Untitled" },
    });
    // Title only: still missing the dataset and metrics.
    expect(create).toBeDisabled();

    fireEvent.change(await screen.findByLabelText("Dataset"), {
      target: { value: "dataset-1" },
    });
    // Dataset but no metric selected.
    expect(create).toBeDisabled();

    fireEvent.click(await screen.findByLabelText(/Revenue/));
    await waitFor(() => expect(create).toBeEnabled());

    // No report is created while the form is incomplete.
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("builds an investigation report from a chosen investigation", async () => {
    render(<ReportsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New Report" }));
    fireEvent.change(await screen.findByLabelText("Report title"), {
      target: { value: "Drop analysis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Investigation report" }));

    const select = await screen.findByLabelText("Investigation");
    // Metrics are not part of an investigation report.
    expect(screen.queryByLabelText("Dataset")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Metrics$/)).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "inv-1" } });

    const create = screen.getByRole("button", { name: "Create" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => {
      expect(
        api.requests.some((r) => r.method === "POST" && r.url.endsWith("/ai/reports")),
      ).toBe(true);
    });
    const post = api.requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/ai/reports"),
    )!;
    expect(post.body).toMatchObject({
      reportType: "INVESTIGATION",
      investigationId: "inv-1",
    });
  });

  it("reports a failed generation instead of showing a download action", async () => {
    api.restore();
    api = mockApi(builderRoutes({
      "/ai/reports": {
        reports: [
          {
            ...fixtures[0]!,
            status: "FAILED",
            error: "The dataset has no rows for the selected period.",
          },
        ],
      },
    }));

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText(/The dataset has no rows/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Download PDF" })).not.toBeInTheDocument();
  });

  it("generates a DRAFT report on demand", async () => {
    api.restore();
    api = mockApi(builderRoutes({
      "/ai/reports/report-1/generate": {
        report: { ...fixtures[0], status: "GENERATED" },
      },
    }));

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText("Generate")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(api.requestsFor("/ai/reports/report-1/generate").length).toBe(1);
    });
    expect(api.requestsFor("/ai/reports/report-1/generate")[0]!.method).toBe("POST");
  });
});

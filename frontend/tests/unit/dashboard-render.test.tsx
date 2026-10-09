import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import DashboardPage from "@/app/(app)/dashboard/page";
import type { DashboardPreviewDTO, EntitlementsDTO } from "@/lib/types";
import { api } from "@/lib/api-client";

const mockDashboardPreview: DashboardPreviewDTO = {
  id: "dash-1",
  name: "Business Dashboard",
  widgets: [
    {
      id: "w-1",
      type: "KPI",
      title: "Revenue",
      data: {
        available: true,
        metricKind: "REVENUE",
        value: 125000.5,
        unit: "USD",
        previousValue: 110000,
        change: 15000.5,
        changePct: 13.6,
        changeAvailable: true,
      },
    },
    {
      id: "w-2",
      type: "KPI",
      title: "Orders",
      data: {
        available: true,
        metricKind: "ORDERS",
        value: 1250,
        unit: "orders",
        previousValue: 1100,
        change: 150,
        changePct: 13.6,
        changeAvailable: true,
      },
    },
    {
      id: "w-3",
      type: "KPI",
      title: "Customers",
      data: {
        available: true,
        metricKind: "CUSTOMERS",
        value: 890,
        unit: "customers",
        previousValue: 850,
        change: 40,
        changePct: 4.7,
        changeAvailable: true,
      },
    },
    {
      id: "w-4",
      type: "LINE",
      title: "Revenue over time",
      data: {
        available: true,
        metricKind: "REVENUE",
        rows: [
          { group: "2024-01", value: 8000 },
          { group: "2024-02", value: 9500 },
          { group: "2024-03", value: 11000 },
          { group: "2024-04", value: 12500 },
        ],
      },
    },
    {
      id: "w-5",
      type: "BAR",
      title: "Revenue by region",
      data: {
        available: true,
        metricKind: "REVENUE",
        rows: [
          { group: "North", value: 45000 },
          { group: "South", value: 35000 },
          { group: "East", value: 28000 },
          { group: "West", value: 17000 },
        ],
      },
    },
    {
      id: "w-6",
      type: "PIE",
      title: "Orders by product",
      data: {
        available: true,
        metricKind: "ORDERS",
        rows: [
          { group: "Product A", value: 500 },
          { group: "Product B", value: 350 },
          { group: "Product C", value: 250 },
          { group: "Product D", value: 150 },
        ],
      },
    },
    {
      id: "w-7",
      type: "TABLE",
      title: "Orders by category",
      data: {
        available: true,
        metricKind: "ORDERS",
        rows: [
          { group: "Electronics", value: 450 },
          { group: "Clothing", value: 380 },
          { group: "Home", value: 250 },
          { group: "Sports", value: 170 },
        ],
        total: 1250,
      },
    },
  ],
};

const emptyDashboardPreview: DashboardPreviewDTO = {
  id: "dash-1",
  name: "Business Dashboard",
  widgets: [
    {
      id: "w-1",
      type: "KPI",
      title: "Revenue",
      data: {
        available: false,
      },
    },
    {
      id: "w-2",
      type: "LINE",
      title: "Revenue over time",
      data: {
        available: false,
      },
    },
  ],
};

const noWidgetsDashboardPreview: DashboardPreviewDTO = {
  id: "dash-1",
  name: "Business Dashboard",
  widgets: [],
};

const mockDashboardsList = {
  dashboards: [
    { id: "dash-1", name: "Business Dashboard", layout: null, widgets: [], createdAt: "", updatedAt: "" },
  ],
};

let mockPreviewResponse: DashboardPreviewDTO = mockDashboardPreview;
let mockPreviewDelay = 0;

vi.mock("@/lib/api-client", () => ({
  api: {
    dashboards: {
      list: vi.fn(async () => mockDashboardsList),
      preview: vi.fn(async () => {
        if (mockPreviewDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, mockPreviewDelay));
        }
        return mockPreviewResponse;
      }),
    },
    // Dashboard side panels (insights + activity/health) — empty results so
    // they settle into their honest "nothing to show" states instead of
    // erroring against an endpoint this mock does not implement.
    anomalyDetections: {
      list: vi.fn(async () => ({ anomalies: [], total: 0 })),
    },
    recommendations: {
      list: vi.fn(async () => ({ recommendations: [] })),
    },
    alerts: {
      list: vi.fn(async () => ({
        alerts: [],
        meta: { page: 1, perPage: 4, total: 0 },
      })),
    },
    imports: {
      list: vi.fn(async () => ({
        imports: [],
        meta: { page: 1, pageSize: 5, total: 0, hasMore: false },
      })),
    },
    datasets: {
      list: vi.fn(async () => ({ datasets: [] })),
      quality: vi.fn(async (datasetId: string) => {
        throw new Error(`no quality report for ${datasetId}`);
      }),
    },
    // Generic transport used by use-entitlements / useUsage hooks.
    get: vi.fn(async (path: string) => {
      const entitlements: EntitlementsDTO = {
        plan: { key: "free", name: "Free" },
        features: {},
        subscription: null,
      };
      if (path.startsWith("/usage")) {
        return { metric: "imports", periodStart: "", periodEnd: "", amount: 0 };
      }
      return entitlements;
    }),
    usage: {
      get: vi.fn(async (metric: string) => ({
        metric,
        periodStart: "",
        periodEnd: "",
        amount: 0,
      })),
    },
  },
}));

function renderDashboardPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe("Dashboard renders KPI/line/bar/pie/table + empty states", () => {
  beforeEach(() => {
    mockPreviewResponse = mockDashboardPreview;
    mockPreviewDelay = 0;
  });

  it("renders dashboard title and widget count", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Business Dashboard")).toBeInTheDocument();
    expect(await screen.findByText(/widgets?/i)).toBeInTheDocument();
  });

  it("renders KPI cards with values and change indicators", async () => {
    renderDashboardPage();

    await screen.findByText("Revenue");
    expect(await screen.findByText("125,000.5 USD")).toBeInTheDocument();
    expect(await screen.findByText("+15,000.5 (+13.6%)")).toBeInTheDocument();

    expect(await screen.findByText("Orders")).toBeInTheDocument();
    expect(await screen.findByText("1,250 orders")).toBeInTheDocument();

    expect(await screen.findByText("Customers")).toBeInTheDocument();
    expect(await screen.findByText("890 customers")).toBeInTheDocument();
  });

  it("renders LINE chart with data", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Revenue over time")).toBeInTheDocument();
    expect(await screen.findByText("Revenue")).toBeInTheDocument();
  });

  it("renders BAR chart with data", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Revenue by region")).toBeInTheDocument();
  });

  it("renders PIE chart with data", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Orders by product")).toBeInTheDocument();
  });

  it("renders TABLE with data and total", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Orders by category")).toBeInTheDocument();
    expect(screen.getByText("Electronics")).toBeInTheDocument();
    // Scope to the widget's own wrapper: the summary panel beside the hero
    // chart shows a "Total" of its own, so page-level lookup would be
    // ambiguous. The row total sits next to the table, not inside it.
    const table = screen.getByRole("table");
    expect(within(table.parentElement!).getByText("Total")).toBeInTheDocument();
    expect(screen.getAllByText("1,250").length).toBeGreaterThan(0);
  });

  it("shows filter dropdown with date range", async () => {
    renderDashboardPage();

    await screen.findByText(/Showing live data/);
    const filtersButton = screen.getByText((content, element) =>
      element?.tagName === "BUTTON" && content.includes("Filters"),
    );
    await userEvent.click(filtersButton);

    expect(await screen.findByText("Date Range")).toBeInTheDocument();
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(await screen.findByText("Last 7 days")).toBeInTheDocument();
    expect(await screen.findByText("Last 30 days")).toBeInTheDocument();
    expect(await screen.findByText("Last 90 days")).toBeInTheDocument();
    expect(await screen.findByText("Last 12 months")).toBeInTheDocument();
  });

  it("sends the chosen date range to the backend when a preset is picked", async () => {
    renderDashboardPage();

    await screen.findByText(/Showing live data/);
    const filtersButton = screen.getByText((content, element) =>
      element?.tagName === "BUTTON" && content.includes("Filters"),
    );
    await userEvent.click(filtersButton);
    await userEvent.click(await screen.findByText("Last 7 days"));

    await waitFor(() => {
      const lastCall = vi.mocked(api.dashboards.preview).mock.calls.at(-1);
      // The range must actually reach the API, otherwise the backend keeps
      // aggregating everything and the preset appears to do nothing.
      expect(lastCall?.[1]?.filters?.dateFrom).toBeTruthy();
      expect(lastCall?.[1]?.filters?.dateTo).toBeTruthy();
    });

    const sent = vi.mocked(api.dashboards.preview).mock.calls.at(-1)?.[1]?.filters;
    const spanMs =
      new Date(sent!.dateTo!).getTime() - new Date(sent!.dateFrom!).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(spanMs).toBeGreaterThan(sevenDays - 60 * 60 * 1000);
    expect(spanMs).toBeLessThan(sevenDays + 60 * 60 * 1000);
  });

  it("shows honest no_data state when all widgets have no data", async () => {
    mockPreviewResponse = emptyDashboardPreview;
    renderDashboardPage();

    expect(await screen.findByText("No data available for current filters")).toBeInTheDocument();
    expect(await screen.findByText(/Your dashboard is configured .* does not have data matching/)).toBeInTheDocument();
  });

  it("shows empty state when no widgets configured", async () => {
    mockPreviewResponse = noWidgetsDashboardPreview;
    renderDashboardPage();

    expect(await screen.findByText("No widgets configured")).toBeInTheDocument();
    expect(await screen.findByText("Add widgets to your dashboard to start visualizing data")).toBeInTheDocument();
  });

  it("shows loading skeleton while fetching preview", async () => {
    mockPreviewDelay = 100;
    renderDashboardPage();

    expect(await screen.findByText("Loading dashboard data...")).toBeInTheDocument();
  });

  it("renders insights and activity panels with honest empty states", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Anomalies")).toBeInTheDocument();
    expect(await screen.findByText("Recommendations")).toBeInTheDocument();
    expect(await screen.findByText("Alerts")).toBeInTheDocument();
    expect(await screen.findByText("Recent imports")).toBeInTheDocument();
    expect(await screen.findByText("Data quality")).toBeInTheDocument();
    expect(await screen.findByText("Usage vs plan")).toBeInTheDocument();
    expect(
      await screen.findByText("No anomalies detected in this workspace."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Connect a dataset to see its quality score."),
    ).toBeInTheDocument();
  });
});
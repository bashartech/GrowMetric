import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import ReportSchedulesPage from "@/app/(app)/report-schedules/page";
import { mockApi } from "../helpers/mock-api";
import type { ReportScheduleDTO } from "@/lib/types/reports";

const WS = "11111111-1111-4111-8111-111111111111";

const schedules: ReportScheduleDTO[] = [
  {
    id: "sched-1",
    reportId: "report-1",
    frequency: "WEEKLY",
    cron: null,
    timezone: "UTC",
    recipients: ["ops@example.com"],
    enabled: true,
    nextRunAt: "2026-09-01T00:00:00.000Z",
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "sched-2",
    reportId: "report-2",
    frequency: "DAILY",
    cron: null,
    timezone: "America/New_York",
    recipients: ["lead@example.com"],
    enabled: false,
    nextRunAt: "2026-09-02T00:00:00.000Z",
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
];

const reports = [
  {
    id: "report-1",
    reportType: "METRICS" as const,
    kind: "WEEKLY" as const,
    title: "Weekly revenue",
    metricKeys: ["REVENUE" as const],
    filters: null,
    breakdowns: null,
    datasetId: null,
    investigationId: null,
    content: null,
    pdfUrl: null,
    status: "GENERATED" as const,
    error: null,
    generatedById: null,
    organizationId: "org-1",
    workspaceId: WS,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = mockApi({
    "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
    "/ai/report-schedules": { schedules },
    "/ai/reports": { reports },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api.restore();
});

describe("Report Schedules page", () => {
  it("renders each schedule with its frequency, next run and enabled state", async () => {
    render(<ReportSchedulesPage />);

    await waitFor(() => {
      expect(screen.getByText("WEEKLY — report-1")).toBeInTheDocument();
    });
    expect(screen.getByText("DAILY — report-2")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  /**
   * H1. Both list calls on this page feed the same workspace, and the schedule
   * one is the row data itself - a missing `?workspaceId=` here returns another
   * tenant's schedule rows.
   */
  it("scopes both the schedule list and the report picker to the workspace", async () => {
    render(<ReportSchedulesPage />);

    await waitFor(() => {
      expect(api.requestsFor("/ai/report-schedules").length).toBeGreaterThan(0);
    });

    for (const request of api.requestsFor("/ai/report-schedules")) {
      expect(request.url).toContain(`workspaceId=${WS}`);
    }
    for (const request of api.requestsFor("/ai/reports")) {
      expect(request.url).toContain(`workspaceId=${WS}`);
    }
  });

  it("sends the resolved workspace when creating a schedule", async () => {
    render(<ReportSchedulesPage />);

    await waitFor(() => {
      expect(screen.getByText("WEEKLY — report-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Schedule" }));

// The picker only renders once the report list has arrived. There are two
// comboboxes (report, then frequency); the report picker is the first.
const [reportPicker] = await screen.findAllByRole("combobox");
fireEvent.change(reportPicker, { target: { value: "report-1" } });

    const recipients = screen.getByPlaceholderText("Recipients (comma-separated emails)");
    fireEvent.change(recipients, {
      target: { value: "a@example.com, b@example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const created = api.requestsFor("/ai/report-schedules").find(
        (r) => r.method === "POST",
      );
      expect(created).toBeDefined();
    });

    const created = api.requestsFor("/ai/report-schedules").find(
      (r) => r.method === "POST",
    )!;
    // The body carries the workspace so the server can validate it, and the
    // recipients are split and trimmed rather than left as one string.
    expect(created.body).toMatchObject({
      workspaceId: WS,
      reportId: "report-1",
      frequency: "WEEKLY",
      recipients: ["a@example.com", "b@example.com"],
    });
  });

  it("blocks the form when the workspace has no report to schedule", async () => {
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/report-schedules": { schedules },
      "/ai/reports": { reports: [] },
    });

    render(<ReportSchedulesPage />);

    await waitFor(() => {
      expect(screen.getByText("WEEKLY — report-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Schedule" }));

    await waitFor(() => {
      expect(
        screen.getByText("Create a report first before scheduling."),
      ).toBeInTheDocument();
    });
    // No picker, so no way to submit a schedule against a missing report.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("renders an empty list without crashing when nothing is scheduled", async () => {
    api = mockApi({
      "/workspaces": { workspaces: [{ id: WS, name: "Default", isDefault: true }] },
      "/ai/report-schedules": { schedules: [] },
      "/ai/reports": { reports },
    });

    render(<ReportSchedulesPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "New Schedule" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/— report-/)).not.toBeInTheDocument();
  });
});
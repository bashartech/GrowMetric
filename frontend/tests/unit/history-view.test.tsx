import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ImportsPage from "@/app/(app)/data-hub/imports/page";
import { VersionList } from "@/components/data/version-list";
import type { DatasetVersionDTO, ImportJobDTO } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

const imports = vi.mocked((await import("@/lib/api-client")).api.get);

const importFixtures: ImportJobDTO[] = [
  {
    id: "imp-1",
    status: "COMPLETED",
    source: "UPLOAD",
    filename: "sales.csv",
    totalRows: 1240,
    processedRows: 1240,
    error: null,
    dataSource: { id: "ds-1", name: "Sales Source", kind: "FILE" },
    dataset: { id: "dataset-1", name: "Sales 2024", status: "READY" },
    datasetId: "dataset-1",
    startedAt: "2026-09-10T10:00:00.000Z",
    completedAt: "2026-09-10T10:00:05.000Z",
    createdAt: "2026-09-10T09:59:00.000Z",
  },
  {
    id: "imp-2",
    status: "FAILED",
    source: "UPLOAD",
    filename: "broken.csv",
    totalRows: null,
    processedRows: null,
    error: "Import file could not be parsed",
    dataSource: { id: "ds-2", name: "Other Source", kind: "FILE" },
    dataset: null,
    datasetId: null,
    startedAt: "2026-09-11T08:00:00.000Z",
    completedAt: "2026-09-11T08:00:02.000Z",
    createdAt: "2026-09-11T07:59:00.000Z",
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportsPage />
    </QueryClientProvider>,
  );
}

describe("Import history view (US4)", () => {
  it("lists imports with source, filename, rows, status, and timestamps", async () => {
    imports.mockResolvedValueOnce({
      imports: importFixtures,
      meta: { page: 1, pageSize: 20, total: 2, hasMore: false },
    });

    renderPage();

    expect(await screen.findByText("sales.csv")).toBeInTheDocument();
    expect(await screen.findByText("broken.csv")).toBeInTheDocument();
    expect(screen.getByText("1,240 rows")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.getByText("Import file could not be parsed")).toBeInTheDocument();
    expect(screen.getByText("Sales Source", { exact: false })).toBeInTheDocument();
    expect(screen.getByText('into "Sales 2024"', { exact: false })).toBeInTheDocument();
  });

  it("filters by status and refetches", async () => {
    imports.mockResolvedValueOnce({
      imports: importFixtures,
      meta: { page: 1, pageSize: 20, total: 2, hasMore: false },
    });

    renderPage();
    await screen.findByText("sales.csv");

    await userEvent.selectOptions(screen.getByLabelText("Filter"), "FAILED");
    await waitFor(() => {
      const call = imports.mock.calls.at(-1)?.[0];
      expect(call).toContain("status=FAILED");
    });
    expect(imports).toHaveBeenCalledTimes(2);
  });

  it("shows empty state when no imports match", async () => {
    imports.mockResolvedValueOnce({
      imports: [],
      meta: { page: 1, pageSize: 20, total: 0, hasMore: false },
    });

    renderPage();

    expect(await screen.findByText("No imports yet")).toBeInTheDocument();
  });

  it("shows pagination controls and honors the next flag", async () => {
    imports.mockResolvedValueOnce({
      imports: importFixtures,
      meta: { page: 1, pageSize: 1, total: 3, hasMore: true },
    });
    imports.mockResolvedValueOnce({
      imports: [importFixtures[1]!],
      meta: { page: 2, pageSize: 1, total: 3, hasMore: true },
    });

    renderPage();
    await screen.findByText("sales.csv");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText(/Page 2 of/)).toBeInTheDocument());
    expect(screen.getByText("broken.csv")).toBeInTheDocument();
  });
});

describe("VersionList", () => {
  const versions: DatasetVersionDTO[] = [
    {
      id: "v-2",
      datasetId: "dataset-1",
      version: 2,
      commit: "APPEND",
      source: "UPLOAD",
      status: "READY",
      summary: null,
      createdAt: "2026-09-12T10:00:00.000Z",
    },
    {
      id: "v-1",
      datasetId: "dataset-1",
      version: 1,
      commit: "REPLACE",
      source: "UPLOAD",
      status: "READY",
      summary: null,
      createdAt: "2026-09-01T10:00:00.000Z",
    },
  ];

  it("renders each version with commit badge and marks the current one", () => {
    render(<VersionList versions={versions} currentVersionId="v-1" />);

    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("Append")).toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows an empty state when there are no versions", () => {
    render(<VersionList versions={[]} currentVersionId={null} />);

    expect(screen.getByText("No versions recorded yet.")).toBeInTheDocument();
  });
});
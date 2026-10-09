import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DatasetsPage from "@/app/(app)/data-hub/datasets/page";
import type { DatasetDetailDTO, DatasetDTO } from "@/lib/types";

const datasetFixtures: DatasetDTO[] = [
  {
    id: "ds-1",
    name: "Sales 2024",
    kind: "CUSTOM",
    status: "READY",
    rowCount: 1240,
    currentVersionId: "v-1",
    sourceTable: null,
    source: "UPLOAD",
    dataSourceId: null,
    lastSyncAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
  },
  {
    id: "ds-2",
    name: "Orders Q3",
    kind: "CUSTOM",
    status: "READY_WITH_WARNINGS",
    rowCount: 87,
    currentVersionId: "v-1",
    sourceTable: "public.orders",
    source: "TABLE_SYNC",
    dataSourceId: "src-1",
    lastSyncAt: "2026-09-20T10:00:00.000Z",
    createdAt: "2026-09-15T10:00:00.000Z",
  },
];

const detailFixtures: Record<string, DatasetDetailDTO> = {
  "ds-1": {
    ...datasetFixtures[0]!,
    pendingMappings: [],
    columns: [
      {
        id: "col-1",
        name: "total_revenue",
        type: "DECIMAL",
        ordinalPosition: 1,
        isNullable: false,
        semanticKey: "revenue",
        businessMeaning: "Revenue",
        representativeSample: [9.99, 19.99],
      },
      {
        id: "col-2",
        name: "order_date",
        type: "DATE",
        ordinalPosition: 2,
        isNullable: true,
        semanticKey: "order_date",
        businessMeaning: "Order Date",
      },
      {
        id: "col-3",
        name: "mystery_column",
        type: "TEXT",
        ordinalPosition: 3,
        isNullable: true,
        semanticKey: null,
        businessMeaning: null,
      },
    ],
  },
  "ds-2": {
    ...datasetFixtures[1]!,
    pendingMappings: [],
    columns: [
      {
        id: "col-1",
        name: "id",
        type: "INTEGER",
        ordinalPosition: 1,
        isNullable: false,
        semanticKey: null,
        businessMeaning: null,
      },
    ],
  },
};

const { queueSyncMock } = vi.hoisted(() => ({
  queueSyncMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === "/datasets") return { datasets: datasetFixtures };
      if (path === "/imports/imp-sync-1") {
        return {
          id: "imp-sync-1",
          status: "COMPLETED",
          source: "TABLE_SYNC",
          filename: "public.orders",
          totalRows: 87,
          processedRows: 87,
          error: null,
          dataSource: { id: "src-1", name: "Postgres", kind: "EXTERNAL_DB" },
          dataset: null,
          datasetId: "ds-2",
          startedAt: "2026-09-21T10:00:00.000Z",
          completedAt: "2026-09-21T10:00:01.000Z",
          createdAt: "2026-09-21T10:00:00.000Z",
        };
      }
      if (path.startsWith("/datasets/")) {
        const id = path.split("/")[2];
        return detailFixtures[id] ?? null;
      }
      return null;
    }),
    dataSources: {
      sync: vi.fn(async (id: string) => {
        queueSyncMock(`/data-sources/${id}/sync`);
        return {
          importJobs: [
            {
              id: "imp-sync-1",
              status: "QUEUED",
              source: "TABLE_SYNC",
              filename: "public.orders",
              totalRows: null,
              processedRows: null,
              error: null,
              dataSource: { id: "src-1", name: "Postgres", kind: "EXTERNAL_DB" },
              dataset: null,
              datasetId: "ds-2",
              startedAt: null,
              completedAt: null,
              createdAt: "2026-09-21T10:00:00.000Z",
            },
          ],
        };
      }),
    },
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DatasetsPage />
    </QueryClientProvider>,
  );
}

describe("Dataset detail/schema view", () => {
  it("lists datasets with name and row count", async () => {
    renderPage();

    expect(await screen.findByText("Sales 2024")).toBeInTheDocument();
    expect(await screen.findByText("Orders Q3")).toBeInTheDocument();
    expect(screen.getByText("1,240 rows")).toBeInTheDocument();
    expect(screen.getByText("87 rows")).toBeInTheDocument();
  });

  it("shows status for each dataset", async () => {
    renderPage();

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(await screen.findByText("Ready (Warnings)")).toBeInTheDocument();
  });

  it("renders schema with column, type, and semantic key", async () => {
    renderPage();

    await screen.findByText("Sales 2024");
    await userEvent.click(screen.getByText("Sales 2024"));

    await waitFor(async () => {
      expect(await screen.findByText("Schema")).toBeInTheDocument();
    });
    expect(await screen.findByText("total_revenue")).toBeInTheDocument();
    expect(await screen.findByText("DECIMAL")).toBeInTheDocument();
    expect(await screen.findByText("revenue")).toBeInTheDocument();
    // "order_date" appears as the column name and as its semantic badge
    expect((await screen.findAllByText("order_date")).length).toBeGreaterThan(0);
  });

  it("shows a placeholder for columns without a semantic key", async () => {
    renderPage();

    await screen.findByText("Sales 2024");
    await userEvent.click(screen.getByText("Sales 2024"));

    expect(await screen.findByText("mystery_column")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows rows/columns counts in the detail panel", async () => {
    renderPage();

    await screen.findByText("Sales 2024");
    await userEvent.click(screen.getByText("Sales 2024"));

    expect(await screen.findByText("1,240")).toBeInTheDocument();
    expect((await screen.findAllByText(/Columns:/)).length).toBeGreaterThan(0);
  });

  it("shows Sync from source instead of file Re-import for table-sync datasets", async () => {
    renderPage();

    await screen.findByText("Orders Q3");
    await userEvent.click(screen.getByText("Orders Q3"));

    expect(
      await screen.findByRole("button", { name: /Sync from source/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Source:")).toBeInTheDocument();
    expect(screen.getByText("Table sync")).toBeInTheDocument();
    expect(screen.queryByText("Re-import")).not.toBeInTheDocument();
  });

  it("keeps file Re-import for uploaded datasets", async () => {
    renderPage();

    await screen.findByText("Sales 2024");
    await userEvent.click(screen.getByText("Sales 2024"));

    expect(
      (await screen.findAllByText("Re-import")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Sync from source/ }),
    ).not.toBeInTheDocument();
  });

  it("triggers an external sync and shows its job status", async () => {
    renderPage();

    await screen.findByText("Orders Q3");
    await userEvent.click(screen.getByText("Orders Q3"));

    const syncButton = await screen.findByRole("button", { name: /Sync from source/ });
    await userEvent.click(syncButton);

    await waitFor(() => {
      expect(queueSyncMock).toHaveBeenCalledWith("/data-sources/src-1/sync");
    });
    expect(await screen.findByText("Processed 87 rows")).toBeInTheDocument();
  });
});
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExternalDbForm } from "@/components/data/external-db-form";

const {
  createExternalDbMock,
  listTablesMock,
  updateTableSelectionMock,
  syncMock,
} = vi.hoisted(() => ({
  createExternalDbMock: vi.fn(),
  listTablesMock: vi.fn(),
  updateTableSelectionMock: vi.fn(),
  syncMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    dataSources: {
      createExternalDb: createExternalDbMock,
      listTables: listTablesMock,
      updateTableSelection: updateTableSelectionMock,
      sync: syncMock,
    },
  },
}));

const TABLES = {
  orders: {
    id: "tab-1",
    schemaName: "public",
    tableName: "orders",
    columnCount: 6,
    rowEstimate: 1200,
    isSelected: false,
  },
  customers: {
    id: "tab-2",
    schemaName: "public",
    tableName: "customers",
    columnCount: 4,
    rowEstimate: 80,
    isSelected: false,
  },
};

const DATA_SOURCE = {
  id: "ds-1",
  name: "Production DB",
  kind: "EXTERNAL_DB" as const,
  status: "CONNECTED" as const,
  lastSyncAt: null,
  importCount: 0,
  datasetCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
};

async function fillConnectionForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Data Source Name"), "Production DB");
  await user.type(screen.getByLabelText("Host"), "db.example.com");
  await user.type(screen.getByLabelText("Database"), "analytics");
  await user.type(screen.getByLabelText("Username"), "readonly_user");
  await user.type(screen.getByLabelText("Password"), "secret");
}

describe("ExternalDbForm", () => {
  it("connects to a database and lists discovered tables", async () => {
    const user = userEvent.setup();
    const onConnected = vi.fn();
    render(<ExternalDbForm onConnected={onConnected} />);

    await fillConnectionForm(user);
    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({
      tables: [TABLES.orders, TABLES.customers],
    });

    await user.click(screen.getByRole("button", { name: /connect database/i }));

    expect(await screen.findByText("public · 6 columns")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();

    expect(createExternalDbMock).toHaveBeenCalledWith({
      name: "Production DB",
      host: "db.example.com",
      port: 5432,
      database: "analytics",
      username: "readonly_user",
      password: "secret",
      sslMode: "require",
    });
    expect(listTablesMock).toHaveBeenCalledWith("ds-1");
    expect(onConnected).toHaveBeenCalledWith(DATA_SOURCE);
  });

  it("uses a custom port and SSL mode from the form", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await fillConnectionForm(user);
    await user.clear(screen.getByLabelText("Port"));
    await user.type(screen.getByLabelText("Port"), "6432");
    await user.selectOptions(screen.getByLabelText("SSL Mode"), "disable");

    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({ tables: [] });

    await user.click(screen.getByRole("button", { name: /connect database/i }));

    await waitFor(() =>
      expect(createExternalDbMock).toHaveBeenCalledWith(
        expect.objectContaining({ port: 6432, sslMode: "disable" }),
      ),
    );
  });

  it("auto-fills connection fields from a pasted connection string", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await user.type(screen.getByLabelText("Data Source Name"), "Production DB");
    const hostInput = screen.getByLabelText("Host");
    await user.click(hostInput);
    await user.paste(
      "postgresql://my_user:p%40ss%20word@db.example.com:6432/analytics?sslmode=prefer",
    );

    await waitFor(() => {
      expect((screen.getByLabelText("Database") as HTMLInputElement).value).toBe(
        "analytics",
      );
    });
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe(
      "postgresql://my_user:p%40ss%20word@db.example.com:6432/analytics?sslmode=prefer",
    );
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "6432",
    );
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe(
      "my_user",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "p@ss word",
    );
    expect((screen.getByLabelText("SSL Mode") as HTMLSelectElement).value).toBe(
      "prefer",
    );

    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({ tables: [] });

    await user.click(screen.getByRole("button", { name: /connect database/i }));

    await waitFor(() =>
      expect(createExternalDbMock).toHaveBeenCalledWith({
        name: "Production DB",
        host: "db.example.com",
        port: 6432,
        database: "analytics",
        username: "my_user",
        password: "p@ss word",
        sslMode: "prefer",
      }),
    );
  });

  it("selects tables and starts a sync, reporting import jobs", async () => {
    const user = userEvent.setup();
    const onSyncComplete = vi.fn();
    render(<ExternalDbForm onSyncComplete={onSyncComplete} />);

    await fillConnectionForm(user);
    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({
      tables: [TABLES.orders, TABLES.customers],
    });
    await user.click(screen.getByRole("button", { name: /connect database/i }));
    await screen.findByText("orders");

    await user.click(screen.getByRole("checkbox", { name: /import public.orders/i }));
    await user.click(screen.getByRole("checkbox", { name: /import public.customers/i }));

    updateTableSelectionMock.mockResolvedValueOnce({ selectedCount: 2 });
    syncMock.mockResolvedValueOnce({
      importJobs: [
        {
          id: "imp-1",
          filename: "public.orders",
          status: "QUEUED",
          source: "TABLE_SYNC",
        },
        {
          id: "imp-2",
          filename: "public.customers",
          status: "QUEUED",
          source: "TABLE_SYNC",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: /sync selected tables/i }));

    expect(await screen.findByText("Sync started")).toBeInTheDocument();
    expect(screen.getAllByText(/public.orders/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/public.customers/).length).toBeGreaterThan(0);
    expect(screen.getByText(/public.orders — QUEUED/)).toBeInTheDocument();
    expect(screen.getByText(/public.customers — QUEUED/)).toBeInTheDocument();

    expect(updateTableSelectionMock).toHaveBeenCalledWith("ds-1", {
      tables: [
        {
          schemaName: "public",
          tableName: "orders",
          isSelected: true,
          syncMode: "REPLACE",
          upsertKeyColumnName: null,
        },
        {
          schemaName: "public",
          tableName: "customers",
          isSelected: true,
          syncMode: "REPLACE",
          upsertKeyColumnName: null,
        },
      ],
    });
    expect(syncMock).toHaveBeenCalledWith("ds-1");
    expect(onSyncComplete).toHaveBeenCalledWith([
      expect.objectContaining({ id: "imp-1" }),
      expect.objectContaining({ id: "imp-2" }),
    ]);
  });

  it("persists UPSERT mode with a key column and syncs without duplicates", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await fillConnectionForm(user);
    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({
      tables: [TABLES.orders, TABLES.customers],
    });
    await user.click(screen.getByRole("button", { name: /connect database/i }));
    await screen.findByText("orders");

    await user.click(screen.getByRole("checkbox", { name: /import public.orders/i }));
    await user.selectOptions(screen.getByLabelText("Sync mode for orders"), "UPSERT");
    await user.type(screen.getByLabelText("Upsert key column for orders"), "order_id");

    updateTableSelectionMock.mockResolvedValueOnce({ selectedCount: 1 });
    syncMock.mockResolvedValueOnce({
      importJobs: [{ id: "imp-1", filename: "public.orders", status: "QUEUED", source: "TABLE_SYNC" }],
    });

    await user.click(screen.getByRole("button", { name: /sync selected tables/i }));

    expect(await screen.findByText(/public.orders — QUEUED/)).toBeInTheDocument();
    expect(updateTableSelectionMock).toHaveBeenCalledWith("ds-1", {
      tables: expect.arrayContaining([
        expect.objectContaining({
          schemaName: "public",
          tableName: "orders",
          isSelected: true,
          syncMode: "UPSERT",
          upsertKeyColumnName: "order_id",
        }),
      ]),
    });
  });

  it("blocks UPSERT sync until a key column is provided", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await fillConnectionForm(user);
    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({
      tables: [TABLES.orders, TABLES.customers],
    });
    await user.click(screen.getByRole("button", { name: /connect database/i }));
    await screen.findByText("orders");

    await user.click(screen.getByRole("checkbox", { name: /import public.orders/i }));
    await user.selectOptions(screen.getByLabelText("Sync mode for orders"), "UPSERT");

    await user.click(screen.getByRole("button", { name: /sync selected tables/i }));

    expect(screen.getByText(/needs a key column for public.orders/i)).toBeInTheDocument();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("warns when no tables are selected before syncing", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await fillConnectionForm(user);
    createExternalDbMock.mockResolvedValueOnce({ dataSource: DATA_SOURCE });
    listTablesMock.mockResolvedValueOnce({
      tables: [TABLES.orders, TABLES.customers],
    });
    await user.click(screen.getByRole("button", { name: /connect database/i }));
    await screen.findByText("orders");

    await user.click(screen.getByRole("button", { name: /sync selected tables/i }));

    expect(screen.getByText(/select at least one table/i)).toBeInTheDocument();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("shows the server error when the connection fails", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await fillConnectionForm(user);
    createExternalDbMock.mockRejectedValueOnce(new Error("Connection refused"));

    await user.click(screen.getByRole("button", { name: /connect database/i }));

    expect(await screen.findByText("Connection refused")).toBeInTheDocument();
    expect(listTablesMock).not.toHaveBeenCalled();
  });

  it("rejects incomplete connection fields", async () => {
    const user = userEvent.setup();
    render(<ExternalDbForm />);

    await user.type(screen.getByLabelText("Data Source Name"), "Production DB");

    await user.click(screen.getByRole("button", { name: /connect database/i }));

    expect(screen.getByText(/fill in all connection fields/i)).toBeInTheDocument();
    expect(createExternalDbMock).not.toHaveBeenCalled();
  });
});
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReimportForm } from "@/components/data/reimport-form";

const { reimportMock } = vi.hoisted(() => ({
  reimportMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    datasets: {
      reimport: reimportMock,
    },
  },
}));

const COLUMNS = [{ name: "id" }, { name: "amount" }];

const IMPORT_JOB = {
  id: "imp-1",
  status: "QUEUED",
  filename: "incremental.csv",
  source: "UPLOAD",
  createdAt: "2026-01-02T00:00:00Z",
};

function fileInput() {
  return screen.getByLabelText(/file/i) as HTMLInputElement;
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(fileInput(), new File(["id,amount\n1,10"], "incremental.csv", { type: "text/csv" }));
}

describe("ReimportForm", () => {
  it("shows the file picker, commit options, and submit button", () => {
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} />);

    expect(screen.getByText("Click to upload")).toBeInTheDocument();
    expect(screen.getByText("Append")).toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("Upsert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-import" })).toBeInTheDocument();
  });

  it("requires a file before submitting", async () => {
    const user = userEvent.setup();
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} />);

    await user.click(screen.getByRole("button", { name: "Re-import" }));

    expect(screen.getByText("Please choose a file to re-import")).toBeInTheDocument();
    expect(reimportMock).not.toHaveBeenCalled();
  });

  it("submits APPEND by default", async () => {
    const user = userEvent.setup();
    reimportMock.mockResolvedValue({ import: IMPORT_JOB });
    const onComplete = vi.fn();
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} onReimportComplete={onComplete} />);

    await chooseFile(user);
    await user.click(screen.getByRole("button", { name: "Re-import" }));

    await waitFor(() => {
      expect(reimportMock).toHaveBeenCalledWith(
        "ds-1",
        { commit: "APPEND", upsertKey: undefined },
        expect.any(File),
      );
      expect(onComplete).toHaveBeenCalledWith({ import: IMPORT_JOB });
    });
  });

  it("submits REPLACE when selected", async () => {
    const user = userEvent.setup();
    reimportMock.mockResolvedValue({ import: IMPORT_JOB });
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} />);

    await chooseFile(user);
    await user.click(screen.getByText("Replace"));
    await user.click(screen.getByRole("button", { name: "Re-import" }));

    await waitFor(() => {
      expect(reimportMock).toHaveBeenCalledWith(
        "ds-1",
        { commit: "REPLACE", upsertKey: undefined },
        expect.any(File),
      );
    });
  });

  it("requires a key column for UPSERT", async () => {
    const user = userEvent.setup();
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} />);

    await chooseFile(user);
    await user.click(screen.getByText("Upsert"));
    await user.click(screen.getByRole("button", { name: "Re-import" }));

    expect(screen.getByText("Choose a key column for upsert")).toBeInTheDocument();
    expect(reimportMock).not.toHaveBeenCalled();
  });

  it("submits UPSERT with the selected key column", async () => {
    const user = userEvent.setup();
    reimportMock.mockResolvedValue({ import: IMPORT_JOB });
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} />);

    await chooseFile(user);
    await user.click(screen.getByText("Upsert"));
    await user.selectOptions(screen.getByLabelText("Key Column"), "id");
    await user.click(screen.getByRole("button", { name: "Re-import" }));

    await waitFor(() => {
      expect(reimportMock).toHaveBeenCalledWith(
        "ds-1",
        { commit: "UPSERT", upsertKey: "id" },
        expect.any(File),
      );
    });
  });

  it("surfaces backend errors", async () => {
    const user = userEvent.setup();
    reimportMock.mockRejectedValue(new Error("Key column not found"));
    render(<ReimportForm datasetId="ds-1" columns={COLUMNS} />);

    await chooseFile(user);
    await user.click(screen.getByRole("button", { name: "Re-import" }));

    expect(await screen.findByText("Key column not found")).toBeInTheDocument();
  });
});
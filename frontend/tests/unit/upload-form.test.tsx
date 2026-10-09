import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UploadForm } from "@/components/data/upload-form";

const { uploadMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    upload: uploadMock,
  },
}));

function renderForm(onUploadComplete = vi.fn()) {
  const utils = render(<UploadForm onUploadComplete={onUploadComplete} />);
  return {
    ...utils,
    onUploadComplete,
    fileInput: utils.container.querySelector("#file-input") as HTMLInputElement,
  };
}

function file(name: string, size = 1024, type = "text/csv"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("UploadForm", () => {
  it("submits name + file and calls onUploadComplete", async () => {
    const user = userEvent.setup();
    const { fileInput, onUploadComplete } = renderForm();

    await user.type(screen.getByLabelText("Data Source Name"), "Sales Q1");
    await user.upload(fileInput, file("sales.csv"));

    uploadMock.mockResolvedValueOnce({
      dataSource: { id: "ds-1", name: "Sales Q1", kind: "FILE", status: "NEW" },
      import: {
        id: "imp-1",
        status: "QUEUED",
        source: "UPLOAD",
        filename: "sales.csv",
      },
    });

    await user.click(screen.getByRole("button", { name: /upload and import/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    const [path, formData] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe("/data-sources");
    expect(formData.get("name")).toBe("Sales Q1");
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(onUploadComplete).toHaveBeenCalledWith({
      dataSource: { id: "ds-1", name: "Sales Q1", kind: "FILE", status: "NEW" },
      import: {
        id: "imp-1",
        status: "QUEUED",
        source: "UPLOAD",
        filename: "sales.csv",
      },
    });
  });

  it("shows an uploading state and resets the form after success", async () => {
    const user = userEvent.setup();
    const { fileInput } = renderForm();

    await user.type(screen.getByLabelText("Data Source Name"), "Sales Q1");
    await user.upload(fileInput, file("sales.csv"));

    let release!: () => void;
    uploadMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              dataSource: {},
              import: {},
            });
        }),
    );

    await user.click(screen.getByRole("button", { name: /upload and import/i }));

    expect(await screen.findByRole("button", { name: /uploading/i })).toBeDisabled();
    expect(screen.getByLabelText("Data Source Name")).toBeDisabled();

    release();

    await waitFor(() => expect(screen.getByLabelText("Data Source Name")).toHaveValue(""));
  });

  it("rejects an oversized file", () => {
    const { fileInput } = renderForm();

    fireEvent.change(fileInput, {
      target: { files: [file("huge.csv", 26 * 1024 * 1024)] },
    });

    expect(screen.getByText(/less than 25 MB/i)).toBeInTheDocument();
    expect(screen.queryByText("huge.csv")).not.toBeInTheDocument();
  });

  it("rejects unsupported file types", () => {
    const { fileInput } = renderForm();

    fireEvent.change(fileInput, {
      target: { files: [file("notes.docx", 1024, "application/pdf")] },
    });

    expect(screen.getByText(/only csv and excel/i)).toBeInTheDocument();
    expect(screen.queryByText("notes.docx")).not.toBeInTheDocument();
  });
});
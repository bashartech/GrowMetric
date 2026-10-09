import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/components/forms/register-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegisterForm />
    </QueryClientProvider>,
  );
}

describe("RegisterForm", () => {
  it("shows field-level validation errors for empty input", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(
      await screen.findByText("Organization name is required"),
    ).toBeInTheDocument();
  });

  it("rejects an invalid email address", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/work email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
  });

  it("rejects a password without a number", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/^password$/i), "onlyletters");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText("Password must contain at least one number"),
    ).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComingSoon } from "@/components/signals/coming-soon";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";

describe("ComingSoon", () => {
  it("labels the area honestly instead of showing fake data", () => {
    render(
      <ComingSoon
        title="Dashboard"
        description="Available once data is connected."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(
      screen.getByText("Available once data is connected."),
    ).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders a title and description", () => {
    render(<EmptyState title="Nothing yet" description="No records found." />);

    expect(
      screen.getByRole("heading", { name: "Nothing yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No records found.")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("shows a safe generic message", () => {
    render(<ErrorState />);

    expect(
      screen.getByText("Something went wrong. Please try again."),
    ).toBeInTheDocument();
  });
});

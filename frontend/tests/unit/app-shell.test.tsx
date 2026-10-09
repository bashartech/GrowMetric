import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";
import { navigation, navigationItems } from "@/lib/navigation";

let currentPath = "/overview";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

describe("Sidebar", () => {
  it("lists every planned product area", () => {
    currentPath = "/overview";
    render(<Sidebar />);

    for (const item of navigationItems) {
      expect(
        screen.getByRole("link", { name: item.label }),
      ).toBeInTheDocument();
    }
    for (const section of navigation) {
      expect(screen.getByRole("heading", { name: section.title, level: 4 })).toBeInTheDocument();
    }
  });

  it("marks the current area and not the others", () => {
    currentPath = "/data-hub/datasets";
    render(<Sidebar />);

    expect(
      screen.getByRole("link", { name: "Datasets" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Dashboard" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("keeps an area active for nested routes", () => {
    currentPath = "/settings/profile";
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

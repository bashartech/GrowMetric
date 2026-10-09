import { describe, expect, it } from "vitest";
import { dateInputToEndOfDay, dateInputToStartOfDay } from "@/lib/date-filters";

describe("date filter bounds", () => {
  it("anchors the lower bound at the start of the picked day", () => {
    expect(dateInputToStartOfDay("2026-07-01")).toBe("2026-07-01T00:00:00.000Z");
  });

  it("anchors the upper bound at the last instant of the picked day", () => {
    // `new Date("2026-07-31")` is UTC midnight, which would exclude every row
    // on 31 July from an inclusive `value <= ?` range.
    expect(dateInputToEndOfDay("2026-07-31")).toBe("2026-07-31T23:59:59.999Z");
  });

  it("keeps a single picked day as a non-empty range", () => {
    const day = "2026-07-01";
    const from = new Date(dateInputToStartOfDay(day)).getTime();
    const to = new Date(dateInputToEndOfDay(day)).getTime();

    expect(to).toBeGreaterThan(from);
    // A row stored at any point during that day is inside the range.
    const midday = new Date(`${day}T12:00:00.000Z`).getTime();
    expect(midday).toBeGreaterThanOrEqual(from);
    expect(midday).toBeLessThanOrEqual(to);
  });

  it("round-trips back to the same day the user picked", () => {
    expect(dateInputToEndOfDay("2026-07-31").split("T")[0]).toBe("2026-07-31");
    expect(dateInputToStartOfDay("2026-07-31").split("T")[0]).toBe("2026-07-31");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPeriods } from "../../src/modules/investigations/pipeline.js";

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: { $queryRawUnsafe: mocks.queryRawUnsafe },
}));

const DATE_COLUMN_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defaultPeriods", () => {
  it("reads date extrema from DatasetDatetimeValue scoped to the date column", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([
      { min: new Date("2026-01-01T00:00:00.000Z"), max: new Date("2026-04-30T23:59:59.000Z") },
    ]);

    const periods = await defaultPeriods(DATE_COLUMN_ID);

    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = (mocks.queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain('FROM "DatasetDatetimeValue"');
    expect(sql).not.toContain("dataset_datetime_values");
    expect(sql).toContain('WHERE "columnId" = $1::uuid');
    expect(params[0]).toBe(DATE_COLUMN_ID);

    expect(periods.target.from < periods.target.to).toBe(true);
    expect(periods.baseline.from < periods.baseline.to).toBe(true);
    expect(periods.target.to).toBe("2026-04-30T23:59:59.999Z");
    const targetMs = Date.parse(periods.target.to) - Date.parse(periods.target.from);
    const baselineMs = Date.parse(periods.baseline.to) - Date.parse(periods.baseline.from);
    expect(Math.abs(targetMs - baselineMs)).toBeLessThanOrEqual(2000);
  });

  it("fails honestly when the date column has fewer than two distinct values", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([
      { min: new Date("2026-03-05T00:00:00.000Z"), max: new Date("2026-03-05T00:00:00.000Z") },
    ]);

    const error = await defaultPeriods(DATE_COLUMN_ID).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Insufficient date history/);
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
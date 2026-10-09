import { describe, expect, it } from "vitest";
import {
  buildAggregateQuery,
  buildGroupByQuery,
  buildPeriodCompareQuery,
  valueTableFor,
} from "../../src/lib/analytics-sql.js";

function containsDate(params: unknown[], isoDate: string): boolean {
  return params.some(
    (param) => param instanceof Date && param.toISOString() === isoDate,
  );
}

describe("valueTableFor", () => {
  it("maps numeric types to DatasetNumericValue", () => {
    expect(valueTableFor("INTEGER")).toBe("DatasetNumericValue");
    expect(valueTableFor("DECIMAL")).toBe("DatasetNumericValue");
  });

  it("maps temporal types to DatasetDatetimeValue", () => {
    expect(valueTableFor("DATE")).toBe("DatasetDatetimeValue");
    expect(valueTableFor("TIME")).toBe("DatasetDatetimeValue");
    expect(valueTableFor("TIMESTAMP")).toBe("DatasetDatetimeValue");
  });

  it("maps BOOLEAN to DatasetBooleanValue", () => {
    expect(valueTableFor("BOOLEAN")).toBe("DatasetBooleanValue");
  });

  it("maps TEXT to DatasetTextValue", () => {
    expect(valueTableFor("TEXT")).toBe("DatasetTextValue");
  });
});

describe("buildAggregateQuery", () => {
  it("builds a parameterized SUM query over the numeric value table", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
    });

    expect(query.sql).toContain("SELECT");
    expect(query.sql).toContain("SUM");
    expect(query.sql).toContain('"DatasetNumericValue"');
    expect(query.sql).toContain('"datasetId"');
    expect(query.sql).toContain('"columnId"');
    expect(query.params).toEqual(["ds-123", "v-1", "col-rev"]);
  });

  it("builds an AVG query", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-456",
      versionId: "v-2",
      columnId: "col-price",
      columnType: "DECIMAL",
      aggregation: "AVG",
    });

    expect(query.sql).toContain("AVG");
    expect(query.params).toContain("ds-456");
  });

  it("builds a COUNT query", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-789",
      versionId: "v-3",
      columnId: "col-order",
      columnType: "INTEGER",
      aggregation: "COUNT",
    });

    expect(query.sql).toContain("COUNT");
    expect(query.params).toContain("col-order");
  });

  it("allows COUNT on text columns", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-1",
      versionId: "v-1",
      columnId: "col-name",
      columnType: "TEXT",
      aggregation: "COUNT",
    });

    expect(query.sql).toContain("COUNT");
  });

  it("rejects non-COUNT aggregations on text columns", () => {
    expect(() =>
      buildAggregateQuery({
        datasetId: "ds-1",
        versionId: "v-1",
        columnId: "col-name",
        columnType: "TEXT",
        aggregation: "SUM",
      }),
    ).toThrow();
  });

  it("rejects unsupported aggregations", () => {
    expect(() =>
      buildAggregateQuery({
        datasetId: "ds-1",
        versionId: "v-1",
        columnId: "col-x",
        columnType: "INTEGER",
        aggregation: "MOD" as never,
      }),
    ).toThrow();
  });

  it("includes date range filter with parameterized values", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      filters: {
        dateColumnId: "col-date",
        dateFrom: new Date("2024-01-01"),
        dateTo: new Date("2024-01-31"),
      },
    });

    console.log("SQL:", query.sql);
    console.log("Params:", query.params);

    expect(query.sql).toMatch(/>=/);
    expect(query.sql).toMatch(/<=/);
    expect(query.sql).toContain("AND");
    expect(query.params).toContain("col-date");
    expect(containsDate(query.params, "2024-01-01T00:00:00.000Z")).toBe(true);
    expect(containsDate(query.params, "2024-01-31T00:00:00.000Z")).toBe(true);
  });

  it("applies an upper bound alone without referencing an unjoined alias", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      filters: {
        dateColumnId: "col-date",
        dateTo: new Date("2024-01-31"),
      },
    });

    // The bound must be attached to an alias that was actually joined. Emitting
    // "dt0" would make Postgres fail with a missing FROM-clause entry.
    const joinedAliases = [
      ...query.sql.matchAll(/JOIN "DatasetDatetimeValue" "(\w+)"/g),
    ].map((match) => match[1]);
    expect(joinedAliases).toEqual(["dt1"]);
    expect(query.sql).toContain('"dt1"."value" <=');
    expect(query.sql).not.toContain('"dt0"');
    expect(query.sql).not.toMatch(/>=/);
  });

  it("reuses one date join for both bounds", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      filters: {
        dateColumnId: "col-date",
        dateFrom: new Date("2024-01-01"),
        dateTo: new Date("2024-01-31"),
      },
    });

    const dateJoins = [
      ...query.sql.matchAll(/JOIN "DatasetDatetimeValue"/g),
    ];
    expect(dateJoins).toHaveLength(1);
    expect(query.params.filter((p) => p === "col-date")).toHaveLength(1);
    expect(query.sql).toContain('"dt1"."value" >=');
    expect(query.sql).toContain('"dt1"."value" <=');
  });

  it("includes dimension filters via column-id mapping", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      filters: {
        dimensions: { region: "West" },
        textColumnIds: { region: "col-region" },
      },
    });

    expect(query.params).toContain("col-region");
    expect(query.params).toContain("West");
    expect(query.sql).toContain("AND");
  });

  it("never interpolates user input into SQL directly", () => {
    const maliciousInput = "'; DROP TABLE users; --";
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      filters: {
        dimensions: { region: maliciousInput },
        textColumnIds: { region: "col-region" },
      },
    });

    expect(query.params).toContain(maliciousInput);
    expect(query.sql).not.toContain("DROP TABLE");
  });
});

describe("buildGroupByQuery", () => {
  it("builds a GROUP BY query joining value and group tables", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-region",
      groupByType: "TEXT",
      aggregation: "SUM",
      limit: 10,
    });

    expect(query.sql).toContain("GROUP BY");
    expect(query.sql).toContain('"DatasetNumericValue"');
    expect(query.sql).toContain('"DatasetTextValue"');
    expect(query.sql).toMatch(/LIMIT \$\d+/);
    expect(query.sql).not.toContain("LIMIT 10");
    expect(query.sql).toContain("ORDER BY");
    expect(query.params).toContain("col-region");
    expect(query.params).toContain(10);
  });

  it("supports numeric group-by columns", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-year",
      groupByType: "INTEGER",
      aggregation: "SUM",
      limit: 10,
    });

    expect(query.sql).toContain("GROUP BY");
    expect(query.sql).toContain('"DatasetNumericValue"');
  });

  it("applies filters with parameterized values", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-cat",
      groupByType: "TEXT",
      aggregation: "SUM",
      limit: 10,
      filters: {
        dimensions: { region: "North" },
        textColumnIds: { region: "col-region" },
      },
    });

    expect(query.params).toContain("North");
    expect(query.sql).not.toContain("'North'");
  });

  it("applies date range to GROUP BY query", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-orders",
      valueColumnType: "INTEGER",
      groupByColumnId: "col-product",
      groupByType: "TEXT",
      aggregation: "COUNT",
      limit: 10,
      filters: {
        dateColumnId: "col-date",
        dateFrom: new Date("2024-01-01"),
        dateTo: new Date("2024-12-31"),
      },
    });

    expect(query.sql).toMatch(/>=/);
    expect(query.sql).toMatch(/<=/);
    expect(containsDate(query.params, "2024-01-01T00:00:00.000Z")).toBe(true);
  });

  it("ranks groups by value descending by default", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-region",
      groupByType: "TEXT",
      aggregation: "SUM",
      limit: 15,
    });

    expect(query.sql).toContain('ORDER BY "value" DESC');
    expect(query.params).toContain(15);
  });

  it("orders by group key ascending when asked", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-date",
      groupByType: "DATE",
      aggregation: "SUM",
      limit: 40,
      orderBy: "group",
    });

    expect(query.sql).toContain('ORDER BY "group" ASC');
    expect(query.sql).not.toContain('ORDER BY "value"');
    expect(query.params).toContain(40);
  });

  it("orders by group key descending when asked (latest buckets first)", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-date",
      groupByType: "DATE",
      aggregation: "SUM",
      limit: 40,
      orderBy: "group_desc",
    });

    expect(query.sql).toContain('ORDER BY "group" DESC');
    expect(query.sql).not.toContain('ORDER BY "value"');
  });
});

describe("buildPeriodCompareQuery", () => {
  it("builds a period-bounded aggregate query", () => {
    const query = buildPeriodCompareQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      dateColumnId: "col-date",
      periodFrom: new Date("2024-02-01"),
      periodTo: new Date("2024-02-29"),
    });

    expect(query.sql).toMatch(/>=/);
    expect(query.sql).toMatch(/<=/);
    expect(query.params).toContain("col-date");
    expect(containsDate(query.params, "2024-02-01T00:00:00.000Z")).toBe(true);
    expect(containsDate(query.params, "2024-02-29T00:00:00.000Z")).toBe(true);
  });

  it("carries dimension filters into the period query", () => {
    const query = buildPeriodCompareQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      dateColumnId: "col-date",
      periodFrom: new Date("2024-02-01"),
      periodTo: new Date("2024-02-29"),
      filters: {
        dimensions: { category: "Electronics" },
        textColumnIds: { category: "col-cat" },
      },
    });

    expect(query.params).toContain("col-cat");
    expect(query.params).toContain("Electronics");
  });

  it("builds previous period bounds correctly", () => {
    const query = buildPeriodCompareQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      dateColumnId: "col-date",
      periodFrom: new Date("2024-02-01"),
      periodTo: new Date("2024-02-29"),
    });

    expect(query.params).toContain("col-date");
    expect(query.params.length).toBeGreaterThan(3);
  });
});

describe("analytics-sql with filters/periods correctness", () => {
  it("builds aggregate with both date range and dimension filters", () => {
    const query = buildAggregateQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      filters: {
        dateColumnId: "col-date",
        dateFrom: new Date("2024-01-01"),
        dateTo: new Date("2024-12-31"),
        dimensions: { region: "West", category: "Electronics" },
        textColumnIds: { region: "col-region", category: "col-cat" },
      },
    });

    expect(query.sql).toMatch(/>=/);
    expect(query.sql).toMatch(/<=/);
    expect(query.sql).toContain("AND");
    expect(query.params).toContain("col-date");
    expect(query.params).toContain("col-region");
    expect(query.params).toContain("West");
    expect(query.params).toContain("col-cat");
    expect(query.params).toContain("Electronics");
  });

  it("builds group-by with date range filter", () => {
    const query = buildGroupByQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      valueColumnId: "col-rev",
      valueColumnType: "DECIMAL",
      groupByColumnId: "col-region",
      groupByType: "TEXT",
      aggregation: "SUM",
      limit: 10,
      filters: {
        dateColumnId: "col-date",
        dateFrom: new Date("2024-01-01"),
        dateTo: new Date("2024-12-31T23:59:59.000Z"),
      },
    });

    expect(query.sql).toContain("GROUP BY");
    expect(query.sql).toMatch(/>=/);
    expect(query.sql).toMatch(/<=/);
    expect(containsDate(query.params, "2024-01-01T00:00:00.000Z")).toBe(true);
    expect(containsDate(query.params, "2024-12-31T23:59:59.000Z")).toBe(true);
  });

  it("builds period compare with combined filters", () => {
    const query = buildPeriodCompareQuery({
      datasetId: "ds-123",
      versionId: "v-1",
      columnId: "col-rev",
      columnType: "DECIMAL",
      aggregation: "SUM",
      dateColumnId: "col-date",
      periodFrom: new Date("2024-01-01"),
      periodTo: new Date("2024-01-31"),
      filters: {
        dimensions: { region: "East" },
        textColumnIds: { region: "col-region" },
      },
    });

    expect(query.sql).toMatch(/>=/);
    expect(query.sql).toMatch(/<=/);
    expect(query.params).toContain("col-date");
    expect(query.params).toContain("col-region");
    expect(query.params).toContain("East");
  });

  it("never uses string interpolation for any user-provided values", () => {
    const maliciousValues = ["'; DROP TABLE users; --", "1; DELETE FROM data; --", "' OR '1'='1"];

    for (const malicious of maliciousValues) {
      const aggQuery = buildAggregateQuery({
        datasetId: "ds-1",
        versionId: "v-1",
        columnId: "col-rev",
        columnType: "DECIMAL",
        aggregation: "SUM",
        filters: {
          dimensions: { region: malicious },
          textColumnIds: { region: "col-region" },
        },
      });
      expect(aggQuery.params).toContain(malicious);
      expect(aggQuery.sql).not.toContain("DROP TABLE");
      expect(aggQuery.sql).not.toContain("DELETE FROM");
      expect(aggQuery.sql).not.toContain("OR '1'='1");

      const groupQuery = buildGroupByQuery({
        datasetId: "ds-1",
        versionId: "v-1",
        valueColumnId: "col-rev",
        valueColumnType: "DECIMAL",
        groupByColumnId: "col-region",
        groupByType: "TEXT",
        aggregation: "SUM",
        limit: 10,
        filters: {
          dimensions: { region: malicious },
          textColumnIds: { region: "col-region" },
        },
      });
      expect(groupQuery.params).toContain(malicious);

      const periodQuery = buildPeriodCompareQuery({
        datasetId: "ds-1",
        versionId: "v-1",
        columnId: "col-rev",
        columnType: "DECIMAL",
        aggregation: "SUM",
        dateColumnId: "col-date",
        periodFrom: new Date("2024-01-01"),
        periodTo: new Date("2024-01-31"),
        filters: {
          dimensions: { region: malicious },
          textColumnIds: { region: "col-region" },
        },
      });
      expect(periodQuery.params).toContain(malicious);
    }
  });
});
import type { ColumnType } from "@prisma/client";
import { AGGREGATE_FUNCTIONS, type AGGREGATIONS } from "../modules/analytics/metric-catalog.js";
import { AppError } from "./http-errors.js";

export type AggregateFunction = (typeof AGGREGATIONS)[number];

export interface FilterPredicates {
  dateFrom?: Date;
  dateTo?: Date;
  dateColumnId?: string;
  dimensions?: Record<string, string>;
  textColumnIds?: Record<string, string>;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export function valueTableFor(type: ColumnType): string {
  switch (type) {
    case "INTEGER":
    case "DECIMAL":
      return "DatasetNumericValue";
    case "BOOLEAN":
      return "DatasetBooleanValue";
    case "DATE":
    case "TIME":
    case "TIMESTAMP":
      return "DatasetDatetimeValue";
    default:
      return "DatasetTextValue";
  }
}

const JOIN_ROW = "JOIN \"DatasetRow\" r ON r.\"id\" = v.\"rowId\"";

/**
 * Emits the joins and predicates for a filter set.
 *
 * Callers must resolve a date column before passing date bounds: a date bound
 * without `dateColumnId` cannot be applied and is skipped, which would turn
 * every range into the same all-time aggregate. `resolveFilters` in
 * metrics.service.ts guarantees that invariant and throws when it cannot.
 */
function buildFilterJoins(
  filters: FilterPredicates | undefined,
  params: unknown[],
  _baseAlias: string,
): { joins: string; whereClauses: string[] } {
  const joins: string[] = [];
  const whereClauses: string[] = [];
  let joinCounter = 0;

  // One join serves both bounds. DatasetDatetimeValue is keyed by
  // @@id([rowId, columnId]), so a second join on the same column could not
  // change the row count -- it was only wasted work.
  if (filters?.dateColumnId && (filters.dateFrom || filters.dateTo)) {
    joinCounter++;
    const alias = `dt${joinCounter}`;
    params.push(filters.dateColumnId);
    joins.push(
      `JOIN "DatasetDatetimeValue" "${alias}" ON "${alias}"."rowId" = r."id" AND "${alias}"."columnId" = $${params.length}::uuid`,
    );
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      whereClauses.push(`"${alias}"."value" >= $${params.length}`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      whereClauses.push(`"${alias}"."value" <= $${params.length}`);
    }
  }

  for (const [dimension, value] of Object.entries(filters?.dimensions ?? {})) {
    const columnId = filters?.textColumnIds?.[dimension];
    if (!columnId) continue;
    joinCounter++;
    const alias = `txt${joinCounter}`;
    params.push(columnId);
    params.push(value);
    joins.push(
      `JOIN "DatasetTextValue" "${alias}" ON "${alias}"."rowId" = r."id" AND "${alias}"."columnId" = $${params.length - 1}::uuid`,
    );
    whereClauses.push(`"${alias}"."value" = $${params.length}`);
  }

  return { joins: joins.join(" "), whereClauses };
}

export interface AggregateArgs {
  datasetId: string;
  versionId: string;
  columnId: string;
  columnType: ColumnType;
  aggregation: AggregateFunction;
  filters?: FilterPredicates;
}

export function buildAggregateQuery(args: AggregateArgs): BuiltQuery {
  if (!AGGREGATE_FUNCTIONS[args.aggregation]) {
    throw new AppError("VALIDATION_ERROR", `Unsupported aggregation: ${args.aggregation}`);
  }
  const table = valueTableFor(args.columnType);
  if (table === "DatasetTextValue" && args.aggregation !== "COUNT") {
    throw new AppError(
      "VALIDATION_ERROR",
      `Aggregation ${args.aggregation} is not supported on text columns.`,
    );
  }
  const params: unknown[] = [args.datasetId, args.versionId, args.columnId];
  const fn =
    args.aggregation === "COUNT" ? "COUNT(v.\"value\")" : `${args.aggregation}(v."value")`;

  const { joins, whereClauses } = buildFilterJoins(args.filters, params, "v");
  const whereClausesWithScope = [
    "r.\"datasetId\" = $1::uuid",
    "r.\"datasetVersionId\" = $2::uuid",
    "v.\"columnId\" = $3::uuid",
    ...whereClauses,
  ];
  const where = `WHERE ${whereClausesWithScope.join(" AND ")}`;

  const sql = `SELECT ${fn} AS result FROM "${table}" v ${JOIN_ROW} ${joins} ${where}`;
  return { sql, params };
}

export interface GroupByArgs {
  datasetId: string;
  versionId: string;
  valueColumnId: string;
  valueColumnType: ColumnType;
  groupByColumnId: string;
  groupByType: ColumnType;
  aggregation: AggregateFunction;
  limit: number;
  filters?: FilterPredicates;
  /** "value" (default) ranks groups by metric; "group"/"group_desc" sort by the
   * group key itself so time series come back in chronological order. */
  orderBy?: "value" | "group" | "group_desc";
}

export function buildGroupByQuery(args: GroupByArgs): BuiltQuery {
  const table = valueTableFor(args.valueColumnType);
  const groupTable = valueTableFor(args.groupByType);
  const params: unknown[] = [
    args.datasetId,
    args.versionId,
    args.valueColumnId,
    args.groupByColumnId,
  ];
  const aggregate =
    args.aggregation === "COUNT"
      ? "COUNT(g.\"value\")"
      : `${args.aggregation}(v."value")`;

  const { joins, whereClauses } = buildFilterJoins(args.filters, params, "v");
  const where = whereClauses.length > 0 ? ` AND ${whereClauses.join(" AND ")}` : "";
  const orderBy =
    args.orderBy === "group"
      ? 'ORDER BY "group" ASC'
      : args.orderBy === "group_desc"
        ? 'ORDER BY "group" DESC'
        : 'ORDER BY "value" DESC';

  const sql = `SELECT g."value" AS "group", ${aggregate} AS "value"
    FROM "${table}" v
    JOIN "DatasetRow" r ON r."id" = v."rowId"
    JOIN "${groupTable}" g ON g."rowId" = r."id"
    ${joins}
    WHERE r."datasetId" = $1::uuid AND r."datasetVersionId" = $2::uuid AND v."columnId" = $3::uuid
      AND g."columnId" = $4::uuid
      AND g."value" IS NOT NULL
      ${where}
    GROUP BY g."value"
    ${orderBy}
    LIMIT $${params.length + 1}`;
  params.push(Math.trunc(args.limit));
  return { sql, params };
}

export interface PeriodCompareArgs extends AggregateArgs {
  periodFrom: Date;
  periodTo: Date;
  dateColumnId: string;
}

export function buildPeriodCompareQuery(args: PeriodCompareArgs): BuiltQuery {
  const inner = buildAggregateQuery({
    datasetId: args.datasetId,
    versionId: args.versionId,
    columnId: args.columnId,
    columnType: args.columnType,
    aggregation: args.aggregation,
    filters: {
      ...args.filters,
      dateFrom: args.periodFrom,
      dateTo: args.periodTo,
      dateColumnId: args.dateColumnId,
    },
  });
  return inner;
}
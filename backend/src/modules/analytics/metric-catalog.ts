import type { MetricKind } from "@prisma/client";

export interface MetricDefinition {
  name: string;
  kind: MetricKind;
  aggregation: "SUM" | "COUNT" | "AVG" | "MIN" | "MAX";
  unit: string;
}

export const CANONICAL_METRICS: readonly MetricDefinition[] = [
  { name: "Revenue", kind: "REVENUE", aggregation: "SUM", unit: "USD" },
  { name: "Orders", kind: "ORDERS", aggregation: "COUNT", unit: "orders" },
  {
    name: "Customers",
    kind: "CUSTOMERS",
    aggregation: "COUNT",
    unit: "customers",
  },
  { name: "Expenses", kind: "EXPENSES", aggregation: "SUM", unit: "USD" },
  { name: "Profit", kind: "PROFIT", aggregation: "SUM", unit: "USD" },
  {
    name: "Inventory",
    kind: "INVENTORY",
    aggregation: "SUM",
    unit: "units",
  },
] as const;

export const AGGREGATIONS = ["SUM", "AVG", "COUNT", "MIN", "MAX"] as const;

export const AGGREGATE_FUNCTIONS = {
  SUM: "SUM",
  AVG: "AVG",
  COUNT: "COUNT",
  MIN: "MIN",
  MAX: "MAX",
} as const;
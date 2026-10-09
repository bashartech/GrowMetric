import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const plans = [
  {
    key: "free",
    name: "Free",
    priceMonthly: 0,
    featureLimits: {
      aiConversations: -1,
      aiRuns: -1,
      aiInvestigations: -1,
      simulations: true,
      reports: true,
      anomalyDetection: true,
      alerts: true,
      dataSources: -1,
      datasets: -1,
      imports: -1,
    },
  },
  {
    key: "pro",
    name: "Pro",
    priceMonthly: 4900,
    featureLimits: {
      aiConversations: -1,
      aiRuns: -1,
      aiInvestigations: -1,
      simulations: true,
      reports: true,
      anomalyDetection: true,
      alerts: true,
      dataSources: -1,
      datasets: -1,
      imports: -1,
    },
  },
  {
    key: "business",
    name: "Business",
    priceMonthly: 19900,
    featureLimits: {
      aiConversations: -1,
      aiRuns: -1,
      aiInvestigations: -1,
      simulations: true,
      reports: true,
      anomalyDetection: true,
      alerts: true,
      dataSources: -1,
      datasets: -1,
      imports: -1,
    },
  },
];

const businessMetrics = [
  {
    kind: "REVENUE",
    name: "Revenue",
    description: "Total revenue from sales",
    aggregation: "SUM",
    defaultColumn: "revenue",
  },
  {
    kind: "ORDERS",
    name: "Orders",
    description: "Total number of orders",
    aggregation: "COUNT",
    defaultColumn: "order_id",
  },
  {
    kind: "CUSTOMERS",
    name: "Customers",
    description: "Total number of unique customers",
    aggregation: "COUNT",
    defaultColumn: "customer_id",
  },
  {
    kind: "EXPENSES",
    name: "Expenses",
    description: "Total expenses",
    aggregation: "SUM",
    defaultColumn: "expense_amount",
  },
  {
    kind: "PROFIT",
    name: "Profit",
    description: "Net profit (Revenue - Expenses)",
    aggregation: "SUM",
    defaultColumn: "profit",
  },
  {
    kind: "INVENTORY",
    name: "Inventory",
    description: "Current inventory levels",
    aggregation: "SUM",
    defaultColumn: "quantity",
  },
];

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      update: {
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        featureLimits: plan.featureLimits,
      },
      create: plan,
    });
  }
  console.log(`Seeded ${plans.length} plans`);

  // Note: BusinessMetric records are workspace-scoped and created when:
  // 1. A workspace is created (default metrics)
  // 2. A dataset with recognized semantic mappings becomes READY
  // The metric definitions above serve as the canonical catalog.
  console.log(
    `BusinessMetric catalog: ${businessMetrics.length} canonical definitions available for workspace provisioning.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

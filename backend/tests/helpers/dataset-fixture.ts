import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export interface DatasetFixture {
  datasetId: string;
  revenueColumnId: string;
  regionColumnId: string;
  dateColumnId: string;
  versionId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * Builds a READY dataset with revenue, region and order_date columns so
 * `computeMetric` runs real SQL. Report and alert tests need this: a report or
 * rule without a dataset is now refused rather than rendered from placeholders.
 */
export async function createDatasetFixture(
  prisma: PrismaClient,
  organizationId: string,
  workspaceId: string,
  options: {
    name?: string;
    withDateColumn?: boolean;
    rows?: { revenue: number; region?: string; at?: Date }[];
  } = {},
): Promise<DatasetFixture> {
  const rows = options.rows ?? [
    { revenue: 100, region: "North", at: daysAgo(2) },
    { revenue: 250, region: "South", at: daysAgo(2) },
    { revenue: 50, region: "North", at: daysAgo(9) },
  ];

  const source = await prisma.dataSource.create({
    data: { organizationId, workspaceId, name: "Source", kind: "FILE" },
  });
  const dataset = await prisma.dataset.create({
    data: {
      organizationId,
      workspaceId,
      dataSourceId: source.id,
      name: options.name ?? "Sales",
      status: "DRAFT",
    },
  });

  const version = await prisma.datasetVersion.create({
    data: { datasetId: dataset.id, version: 1, commit: "REPLACE", source: "test", status: "READY" },
  });

  const revenueColumn = await prisma.datasetColumn.create({
    data: {
      datasetId: dataset.id,
      datasetVersionId: version.id,
      name: "revenue",
      type: "DECIMAL",
      ordinalPosition: 1,
      semanticKey: "revenue",
    },
  });
  const regionColumn = await prisma.datasetColumn.create({
    data: {
      datasetId: dataset.id,
      datasetVersionId: version.id,
      name: "region",
      type: "TEXT",
      ordinalPosition: 2,
      semanticKey: "region",
    },
  });
  const dateColumn = options.withDateColumn
    ? await prisma.datasetColumn.create({
        data: {
          datasetId: dataset.id,
          datasetVersionId: version.id,
          name: "order_date",
          type: "DATE",
          ordinalPosition: 3,
          semanticKey: "order_date",
        },
      })
    : null;

  for (const [index, row] of rows.entries()) {
    const created = await prisma.datasetRow.create({
      data: { datasetId: dataset.id, datasetVersionId: version.id, rowIndex: index },
    });
    await prisma.datasetNumericValue.create({
      data: { rowId: created.id, columnId: revenueColumn.id, value: row.revenue },
    });
    if (row.region !== undefined) {
      await prisma.datasetTextValue.create({
        data: { rowId: created.id, columnId: regionColumn.id, value: row.region },
      });
    }
    if (dateColumn && row.at) {
      await prisma.datasetDatetimeValue.create({
        data: { rowId: created.id, columnId: dateColumn.id, value: row.at },
      });
    }
  }

  await prisma.dataset.update({
    where: { id: dataset.id },
    data: { currentVersionId: version.id, status: "READY", rowCount: rows.length },
  });

  return {
    datasetId: dataset.id,
    revenueColumnId: revenueColumn.id,
    regionColumnId: regionColumn.id,
    dateColumnId: dateColumn?.id ?? "",
    versionId: version.id,
  };
}

/** Removes an org and everything that RESTRICT-references its users. */
export async function destroyOrganization(prisma: PrismaClient, organizationId: string): Promise<void> {
  await prisma.job.deleteMany({ where: { organizationId } });
  await prisma.emailDelivery.deleteMany({ where: { organizationId } });
  await prisma.alert.deleteMany({ where: { organizationId } });
  await prisma.alertRule.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

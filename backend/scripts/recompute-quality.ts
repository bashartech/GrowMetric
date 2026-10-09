/**
 * Recompute `DataQualityReport` rows for existing dataset versions.
 *
 * The quality gate itself lives in `src/lib/quality.ts` and runs on every
 * import. This script exists because reports written before a change to that
 * gate keep their old verdict, so a dataset can stay stuck on
 * `READY_WITH_WARNINGS` until the next re-import.
 *
 * Usage:
 *   npm run quality:recompute -- --dry    # preview only, no writes
 *   npm run quality:recompute            # apply
 */
import { computeQuality } from "../src/lib/quality.js";
import { prisma } from "../src/lib/prisma.js";

const dryRun = process.argv.includes("--dry");

/** Mirrors `mapDatasetStatus` in `src/modules/datasets/dataset.repo.ts`. */
const toDatasetStatus = (s: string) =>
  s === "CLEAN" ? "READY" : s === "WARNINGS" ? "READY_WITH_WARNINGS" : "ERROR";

type Row = string[];

/**
 * Render a stored datetime back into the *text* form the importer originally
 * parsed, because `computeQuality` re-validates with the column's regexes.
 *
 * This has to be type-aware. A `TIME` column is persisted as a DateTime pinned
 * to the epoch (`1970-01-01T09:00:00.000Z`) but `TIME_RE` only accepts
 * `HH:MM[:SS]`, so handing back the full ISO string reports a perfectly good
 * row as an unparseable date. `DATE` has the mirror-image problem.
 */
export function fromStoredDatetime(value: Date, type: string | undefined): string {
  const iso = new Date(value).toISOString();
  switch (type) {
    case "DATE":
      return iso.slice(0, 10);
    case "TIME":
      return iso.slice(11, 19);
    default:
      return iso;
  }
}

/**
 * Cells live in one table per column type, so a row has to be stitched back
 * together by ordinal position before it can be re-scored.
 */
async function readGrid(datasetVersionId: string) {
  const columns = await prisma.datasetColumn.findMany({
    where: { datasetVersionId },
    orderBy: { ordinalPosition: "asc" },
  });
  const meta = await prisma.datasetRow.findMany({
    where: { datasetVersionId },
    orderBy: { rowIndex: "asc" },
  });
  const rowIds = meta.map((r) => r.id);
  const [texts, numbers, datetimes, booleans] = await Promise.all([
    prisma.datasetTextValue.findMany({ where: { rowId: { in: rowIds } } }),
    prisma.datasetNumericValue.findMany({ where: { rowId: { in: rowIds } } }),
    prisma.datasetDatetimeValue.findMany({ where: { rowId: { in: rowIds } } }),
    prisma.datasetBooleanValue.findMany({ where: { rowId: { in: rowIds } } }),
  ]);

  const ordinalOf = new Map(columns.map((c, i) => [c.id, i]));
  const typeOf = new Map(columns.map((c) => [c.id, c.type]));
  const cells = new Map<string, Map<number, string>>();

  const place = (rowId: string, columnId: string, value: string) => {
    const ordinal = ordinalOf.get(columnId);
    if (ordinal === undefined) return;
    let row = cells.get(rowId);
    if (!row) cells.set(rowId, (row = new Map()));
    row.set(ordinal, value);
  };

  for (const v of texts) place(v.rowId, v.columnId, v.value);
  for (const v of numbers) place(v.rowId, v.columnId, String(v.value));
  for (const v of datetimes) place(v.rowId, v.columnId, fromStoredDatetime(v.value, typeOf.get(v.columnId)));
  for (const v of booleans) place(v.rowId, v.columnId, String(v.value));

  const rows: Row[] = meta.map((r) =>
    columns.map((_, i) => cells.get(r.id)?.get(i) ?? ""),
  );
  return { columns, rows };
}

async function main() {
  // Every version, not just the current one: a superseded version can be
  // promoted back to current later, and its stale verdict would resurface then.
  const versions = await prisma.datasetVersion.findMany({
    include: { dataset: { select: { id: true, name: true, status: true, currentVersionId: true } } },
  });

  const changes: Array<{
    name: string;
    versionLabel: string;
    before: string;
    after: string;
    datasetId: string;
    versionId: string;
    isCurrent: boolean;
    quality: ReturnType<typeof computeQuality>;
  }> = [];

  for (const version of versions) {
    const versionId = version.id;
    const { columns, rows } = await readGrid(versionId);
    // An empty version has nothing to score; writing a report for it would be
    // noise rather than a correction.
    if (rows.length === 0) continue;

    const quality = computeQuality({
      rows,
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        isNullable: c.isNullable,
        mixed: false,
        sample: [],
        nullCount: 0,
      })),
    });
    const report = await prisma.dataQualityReport.findUnique({
      where: { datasetVersionId: versionId },
    });
    const isCurrent = version.dataset.currentVersionId === versionId;
    const after = toDatasetStatus(quality.status);
    const statusDrifted = isCurrent && version.dataset.status !== after;
    if (report?.status !== quality.status || statusDrifted) {
      changes.push({
        name: version.dataset.name,
        versionLabel: isCurrent ? "current" : "superseded",
        before: `${report?.status ?? "none"}${statusDrifted ? `/${version.dataset.status}` : ""}`,
        after: quality.status,
        datasetId: version.dataset.id,
        versionId,
        isCurrent,
        quality,
      });
    }
  }

  if (changes.length === 0) {
    console.log("All reports already agree with the current gate. Nothing to do.");
    return;
  }

  console.log(`${dryRun ? "DRY RUN - " : ""}${changes.length} version(s) would change:\n`);
  for (const c of changes) {
    const q = c.quality;
    console.log(
      `  ${c.name} [${c.versionLabel}]\n` +
        `    ${c.before} -> ${c.after}\n` +
        `    miss=${q.missingValuePct}% dup=${q.duplicateRowPct}% ` +
        `badNum=${q.invalidNumberPct}% badDate=${q.invalidDatePct}% ` +
        `outliers=${q.numericOutlierCount}`,
    );
  }

  if (dryRun) {
    console.log("\nRe-run without --dry to apply.");
    return;
  }

  for (const c of changes) {
    await prisma.$transaction([
      // Upsert rather than update: a dataset can have a current version with
      // rows but no report at all (e.g. it was published by an older code
      // path). `datasetVersionId` is @unique, so this stays idempotent.
      prisma.dataQualityReport.upsert({
        where: { datasetVersionId: c.versionId },
        update: {
          totalRows: c.quality.totalRows,
          columnCount: c.quality.columnCount,
          missingValuePct: c.quality.missingValuePct,
          duplicateRowPct: c.quality.duplicateRowPct,
          invalidNumberPct: c.quality.invalidNumberPct,
          invalidDatePct: c.quality.invalidDatePct,
          numericOutlierCount: c.quality.numericOutlierCount,
          status: c.quality.status,
          detail: c.quality.warnings as never,
        },
        create: {
          datasetId: c.datasetId,
          datasetVersionId: c.versionId,
          totalRows: c.quality.totalRows,
          columnCount: c.quality.columnCount,
          missingValuePct: c.quality.missingValuePct,
          duplicateRowPct: c.quality.duplicateRowPct,
          invalidNumberPct: c.quality.invalidNumberPct,
          invalidDatePct: c.quality.invalidDatePct,
          numericOutlierCount: c.quality.numericOutlierCount,
          status: c.quality.status,
          detail: c.quality.warnings as never,
        },
      }),
      // Only the current version decides the dataset's status; scoring an old
      // version must not demote the dataset the user is actually looking at.
      ...(c.isCurrent
        ? [
            prisma.dataset.update({
              where: { id: c.datasetId },
              data: { status: toDatasetStatus(c.quality.status) },
            }),
          ]
        : []),
    ]);
  }
  console.log(`\nApplied to ${changes.length} version(s).`);
}

// Guarded so the test suite can import `fromStoredDatetime` without the
// script reaching for the database.
if (process.argv[1]?.includes("recompute-quality")) {
  main()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("ERR", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
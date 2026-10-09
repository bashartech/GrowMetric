-- Report builder configuration (D2 + report scope).
-- Adds the user-selected record set: metric keys, filters, breakdowns, the
-- source dataset and the optional investigation, plus the report type that
-- distinguishes a metrics report from an investigation report.
-- `kind` is intentionally unchanged: contracts/reports.md defines it as
-- WEEKLY | MONTHLY | CUSTOM (the cadence).

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('METRICS', 'INVESTIGATION');

-- AlterTable
ALTER TABLE "Report"
ADD COLUMN     "reportType" "ReportType" NOT NULL DEFAULT 'METRICS',
ADD COLUMN     "metricKeys" JSONB,
ADD COLUMN     "filters" JSONB,
ADD COLUMN     "breakdowns" JSONB,
ADD COLUMN     "datasetId" UUID,
ADD COLUMN     "investigationId" UUID;

-- CreateIndex
CREATE INDEX "Report_datasetId_idx" ON "Report"("datasetId");

-- CreateIndex
CREATE INDEX "Report_investigationId_idx" ON "Report"("investigationId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_datasetId_fkey"
FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_investigationId_fkey"
FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

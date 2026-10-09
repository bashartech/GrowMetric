-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('FILE', 'EXTERNAL_DB');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('NEW', 'CONNECTED', 'VALIDATED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ExternalDbEngine" AS ENUM ('POSTGRES');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('UPLOAD', 'TABLE_SYNC');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'REQUESTING_MAPPING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DatasetKind" AS ENUM ('SALES', 'CUSTOMERS', 'PRODUCTS', 'INVENTORY', 'EXPENSES', 'ORDERS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('DRAFT', 'READY', 'READY_WITH_WARNINGS', 'ERROR');

-- CreateEnum
CREATE TYPE "DatasetVersionStatus" AS ENUM ('BUILDING', 'READY');

-- CreateEnum
CREATE TYPE "DatasetCommit" AS ENUM ('APPEND', 'REPLACE', 'UPSERT');

-- CreateEnum
CREATE TYPE "ColumnType" AS ENUM ('TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'TIME');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('MANY_TO_ONE', 'ONE_TO_ONE');

-- CreateEnum
CREATE TYPE "DetectionMethod" AS ENUM ('RULES', 'USER');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('CLEAN', 'WARNINGS', 'ERROR');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('REVENUE', 'ORDERS', 'CUSTOMERS', 'EXPENSES', 'PROFIT', 'INVENTORY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('KPI', 'LINE', 'BAR', 'PIE', 'TABLE');

-- CreateTable
CREATE TABLE "DataSource" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'NEW',
    "lastSyncAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceCredential" (
    "id" UUID NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "engine" "ExternalDbEngine" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 5432,
    "database" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "sslMode" TEXT NOT NULL DEFAULT 'require',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSourceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceTable" (
    "id" UUID NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "schemaName" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "rowEstimate" INTEGER NOT NULL DEFAULT 0,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSourceTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFile" (
    "id" UUID NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "datasetId" UUID,
    "fileId" UUID,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "filename" TEXT NOT NULL,
    "totalRows" INTEGER,
    "processedRows" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DatasetKind" NOT NULL DEFAULT 'CUSTOM',
    "sourceTable" TEXT,
    "status" "DatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" UUID,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "importJobId" UUID,
    "commit" "DatasetCommit" NOT NULL,
    "source" TEXT NOT NULL,
    "status" "DatasetVersionStatus" NOT NULL DEFAULT 'BUILDING',
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetColumn" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ColumnType" NOT NULL,
    "ordinalPosition" INTEGER NOT NULL,
    "isNullable" BOOLEAN NOT NULL DEFAULT true,
    "semanticKey" TEXT,
    "businessMeaning" TEXT,
    "representativeSample" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetRow" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetTextValue" (
    "rowId" UUID NOT NULL,
    "columnId" UUID NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "DatasetTextValue_pkey" PRIMARY KEY ("rowId","columnId")
);

-- CreateTable
CREATE TABLE "DatasetNumericValue" (
    "rowId" UUID NOT NULL,
    "columnId" UUID NOT NULL,
    "value" DECIMAL NOT NULL,

    CONSTRAINT "DatasetNumericValue_pkey" PRIMARY KEY ("rowId","columnId")
);

-- CreateTable
CREATE TABLE "DatasetDatetimeValue" (
    "rowId" UUID NOT NULL,
    "columnId" UUID NOT NULL,
    "value" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetDatetimeValue_pkey" PRIMARY KEY ("rowId","columnId")
);

-- CreateTable
CREATE TABLE "DatasetBooleanValue" (
    "rowId" UUID NOT NULL,
    "columnId" UUID NOT NULL,
    "value" BOOLEAN NOT NULL,

    CONSTRAINT "DatasetBooleanValue_pkey" PRIMARY KEY ("rowId","columnId")
);

-- CreateTable
CREATE TABLE "DatasetRelationship" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "sourceColumnId" UUID NOT NULL,
    "targetDatasetId" UUID,
    "targetColumnId" UUID,
    "relationshipType" "RelationshipType" NOT NULL,
    "detectedBy" "DetectionMethod" NOT NULL,
    "confidence" DECIMAL NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityReport" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "columnCount" INTEGER NOT NULL,
    "missingValuePct" DECIMAL NOT NULL,
    "duplicateRowPct" DECIMAL NOT NULL,
    "invalidNumberPct" DECIMAL NOT NULL,
    "invalidDatePct" DECIMAL NOT NULL,
    "numericOutlierCount" INTEGER NOT NULL DEFAULT 0,
    "status" "QualityStatus" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMetric" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "datasetId" UUID,
    "name" TEXT NOT NULL,
    "kind" "MetricKind" NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dashboard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Business Dashboard',
    "layout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" UUID NOT NULL,
    "dashboardId" UUID NOT NULL,
    "type" "WidgetType" NOT NULL,
    "metricId" UUID,
    "datasetId" UUID,
    "config" JSONB,
    "position" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataSource_organizationId_idx" ON "DataSource"("organizationId");

-- CreateIndex
CREATE INDEX "DataSource_workspaceId_idx" ON "DataSource"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceCredential_dataSourceId_key" ON "DataSourceCredential"("dataSourceId");

-- CreateIndex
CREATE INDEX "DataSourceTable_dataSourceId_idx" ON "DataSourceTable"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceTable_dataSourceId_schemaName_tableName_key" ON "DataSourceTable"("dataSourceId", "schemaName", "tableName");

-- CreateIndex
CREATE INDEX "ImportFile_dataSourceId_idx" ON "ImportFile"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_jobId_key" ON "ImportJob"("jobId");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_idx" ON "ImportJob"("organizationId");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_idx" ON "ImportJob"("workspaceId");

-- CreateIndex
CREATE INDEX "ImportJob_dataSourceId_idx" ON "ImportJob"("dataSourceId");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "Dataset_organizationId_workspaceId_idx" ON "Dataset"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "Dataset_dataSourceId_idx" ON "Dataset"("dataSourceId");

-- CreateIndex
CREATE INDEX "DatasetVersion_datasetId_idx" ON "DatasetVersion"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetVersion_datasetId_version_key" ON "DatasetVersion"("datasetId", "version");

-- CreateIndex
CREATE INDEX "DatasetColumn_datasetId_ordinalPosition_idx" ON "DatasetColumn"("datasetId", "ordinalPosition");

-- CreateIndex
CREATE INDEX "DatasetColumn_datasetVersionId_idx" ON "DatasetColumn"("datasetVersionId");

-- CreateIndex
CREATE INDEX "DatasetRow_datasetId_idx" ON "DatasetRow"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetRow_datasetVersionId_rowIndex_key" ON "DatasetRow"("datasetVersionId", "rowIndex");

-- CreateIndex
CREATE INDEX "DatasetTextValue_columnId_idx" ON "DatasetTextValue"("columnId");

-- CreateIndex
CREATE INDEX "DatasetNumericValue_columnId_idx" ON "DatasetNumericValue"("columnId");

-- CreateIndex
CREATE INDEX "DatasetDatetimeValue_columnId_idx" ON "DatasetDatetimeValue"("columnId");

-- CreateIndex
CREATE INDEX "DatasetBooleanValue_columnId_idx" ON "DatasetBooleanValue"("columnId");

-- CreateIndex
CREATE INDEX "DatasetRelationship_datasetId_idx" ON "DatasetRelationship"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DataQualityReport_datasetVersionId_key" ON "DataQualityReport"("datasetVersionId");

-- CreateIndex
CREATE INDEX "DataQualityReport_datasetId_idx" ON "DataQualityReport"("datasetId");

-- CreateIndex
CREATE INDEX "BusinessMetric_organizationId_idx" ON "BusinessMetric"("organizationId");

-- CreateIndex
CREATE INDEX "BusinessMetric_workspaceId_idx" ON "BusinessMetric"("workspaceId");

-- CreateIndex
CREATE INDEX "Dashboard_organizationId_idx" ON "Dashboard"("organizationId");

-- CreateIndex
CREATE INDEX "Dashboard_workspaceId_idx" ON "Dashboard"("workspaceId");

-- CreateIndex
CREATE INDEX "DashboardWidget_dashboardId_idx" ON "DashboardWidget"("dashboardId");

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceCredential" ADD CONSTRAINT "DataSourceCredential_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceTable" ADD CONSTRAINT "DataSourceTable_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ImportFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetColumn" ADD CONSTRAINT "DatasetColumn_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetColumn" ADD CONSTRAINT "DatasetColumn_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetRow" ADD CONSTRAINT "DatasetRow_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetRow" ADD CONSTRAINT "DatasetRow_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetTextValue" ADD CONSTRAINT "DatasetTextValue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "DatasetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetTextValue" ADD CONSTRAINT "DatasetTextValue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DatasetColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetNumericValue" ADD CONSTRAINT "DatasetNumericValue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "DatasetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetNumericValue" ADD CONSTRAINT "DatasetNumericValue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DatasetColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetDatetimeValue" ADD CONSTRAINT "DatasetDatetimeValue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "DatasetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetDatetimeValue" ADD CONSTRAINT "DatasetDatetimeValue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DatasetColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetBooleanValue" ADD CONSTRAINT "DatasetBooleanValue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "DatasetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetBooleanValue" ADD CONSTRAINT "DatasetBooleanValue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DatasetColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetRelationship" ADD CONSTRAINT "DatasetRelationship_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityReport" ADD CONSTRAINT "DataQualityReport_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityReport" ADD CONSTRAINT "DataQualityReport_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMetric" ADD CONSTRAINT "BusinessMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMetric" ADD CONSTRAINT "BusinessMetric_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMetric" ADD CONSTRAINT "BusinessMetric_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "BusinessMetric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

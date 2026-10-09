-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RecommendationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecommendationSource" AS ENUM ('ANOMALY', 'INVESTIGATION', 'RULE', 'SIMULATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertCondition" AS ENUM ('GREATER_THAN', 'LESS_THAN', 'EQUAL_TO', 'CHANGES_BY');

-- CreateEnum
CREATE TYPE "AlertRuleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'GENERATED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'BOUNCED');

-- CreateTable
CREATE TABLE "AnomalyDetection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "datasetId" UUID,
    "metricId" TEXT,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "baseline" JSONB NOT NULL,
    "observed" JSONB NOT NULL,
    "deviationPct" DECIMAL NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnomalyDetection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "severity" "RecommendationSeverity" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "evidence" JSONB NOT NULL,
    "source" "RecommendationSource" NOT NULL,
    "datasetId" UUID,
    "suggestedAction" TEXT,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "metricKind" TEXT NOT NULL,
    "condition" "AlertCondition" NOT NULL,
    "threshold" DECIMAL NOT NULL,
    "frequency" "AlertRuleFrequency" NOT NULL,
    "cron" TEXT,
    "recipients" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ruleId" UUID,
    "title" VARCHAR(300) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "content" JSONB,
    "pdfUrl" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "generatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "cron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "recipients" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" UUID NOT NULL,
    "jobId" UUID,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "from" TEXT NOT NULL,
    "to" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnomalyDetection_organizationId_workspaceId_createdAt_idx" ON "AnomalyDetection"("organizationId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_organizationId_workspaceId_status_createdAt_idx" ON "Recommendation"("organizationId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AlertRule_organizationId_workspaceId_enabled_idx" ON "AlertRule"("organizationId", "workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "Alert_organizationId_workspaceId_status_createdAt_idx" ON "Alert"("organizationId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_organizationId_workspaceId_status_createdAt_idx" ON "Report"("organizationId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_organizationId_workspaceId_enabled_nextRunAt_idx" ON "ReportSchedule"("organizationId", "workspaceId", "enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AnomalyDetection" ADD CONSTRAINT "AnomalyDetection_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

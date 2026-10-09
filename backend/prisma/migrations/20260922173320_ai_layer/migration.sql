-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('ANALYST');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('CHAT', 'FINDING', 'CHART', 'ERROR');

-- CreateEnum
CREATE TYPE "EvidenceClass" AS ENUM ('OBSERVED', 'CALCULATED', 'INFERRED', 'PROJECTED', 'RECOMMENDED');

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('ANALYST', 'INVESTIGATION', 'SIMULATION', 'MAPPING');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('SUCCESS', 'ERROR', 'TIMEOUT', 'STOPPED');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FindingLevel" AS ENUM ('MAIN', 'SUPPORTING', 'CORRELATION');

-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('DRIVER', 'ANOMALY', 'CONTRIBUTOR', 'STAT_STATIONARY');

-- CreateEnum
CREATE TYPE "SimulationType" AS ENUM ('PRICE_CHANGE', 'MARKETING_SPEND', 'EXPENSE_REDUCTION', 'INVENTORY_CHANGE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'INSUFFICIENT_DATA', 'FAILED');

-- CreateEnum
CREATE TYPE "SuggestionSource" AS ENUM ('RULES', 'AI');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "kind" "ConversationKind" NOT NULL DEFAULT 'ANALYST',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "content" TEXT,
    "evidenceClass" "EvidenceClass",
    "toolCallId" UUID,
    "agentRunId" UUID,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "jobId" UUID,
    "conversationId" UUID,
    "investigationId" UUID,
    "simulationScenarioId" UUID,
    "mappingSuggestionId" UUID,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "toolsUsed" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "runKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCallRecord" (
    "id" UUID NOT NULL,
    "agentRunId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "argumentsJson" JSONB NOT NULL,
    "outputJson" JSONB,
    "status" "ToolCallStatus" NOT NULL,
    "error" TEXT,
    "latencyMs" INTEGER,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'RUNNING',
    "datasetId" UUID,
    "periodTarget" JSONB,
    "periodBaseline" JSONB,
    "error" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationFinding" (
    "id" UUID NOT NULL,
    "investigationId" UUID NOT NULL,
    "level" "FindingLevel" NOT NULL,
    "kind" "FindingKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metricChange" JSONB,
    "evidence" JSONB NOT NULL,
    "confidence" DECIMAL,
    "isCausalClaim" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Simulation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "datasetId" UUID,
    "name" TEXT NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationScenario" (
    "id" UUID NOT NULL,
    "simulationId" UUID NOT NULL,
    "type" "SimulationType" NOT NULL,
    "name" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DECIMAL,
    "sensitivityAlternative" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationResult" (
    "id" UUID NOT NULL,
    "simulationScenarioId" UUID NOT NULL,
    "metricKey" TEXT NOT NULL,
    "currentValue" DECIMAL NOT NULL,
    "projectedValue" DECIMAL NOT NULL,
    "changePct" DECIMAL NOT NULL,
    "confidence" DECIMAL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "assumptionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingSuggestion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "datasetId" UUID,
    "columnId" UUID NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "businessMeaning" TEXT NOT NULL,
    "source" "SuggestionSource" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DECIMAL NOT NULL,
    "agentRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MappingSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_organizationId_workspaceId_updatedAt_idx" ON "Conversation"("organizationId", "workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_idx" ON "Conversation"("organizationId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_agentRunId_idx" ON "Message"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_runKey_key" ON "AgentRun"("runKey");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_workspaceId_createdAt_idx" ON "AgentRun"("organizationId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- CreateIndex
CREATE INDEX "AgentRun_jobId_idx" ON "AgentRun"("jobId");

-- CreateIndex
CREATE INDEX "AgentRun_investigationId_idx" ON "AgentRun"("investigationId");

-- CreateIndex
CREATE INDEX "ToolCallRecord_agentRunId_idx" ON "ToolCallRecord"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolCallRecord_agentRunId_sequence_key" ON "ToolCallRecord"("agentRunId", "sequence");

-- CreateIndex
CREATE INDEX "Investigation_organizationId_workspaceId_createdAt_idx" ON "Investigation"("organizationId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Investigation_organizationId_idx" ON "Investigation"("organizationId");

-- CreateIndex
CREATE INDEX "Investigation_workspaceId_idx" ON "Investigation"("workspaceId");

-- CreateIndex
CREATE INDEX "InvestigationFinding_investigationId_idx" ON "InvestigationFinding"("investigationId");

-- CreateIndex
CREATE INDEX "Simulation_organizationId_workspaceId_idx" ON "Simulation"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "Simulation_organizationId_idx" ON "Simulation"("organizationId");

-- CreateIndex
CREATE INDEX "Simulation_workspaceId_idx" ON "Simulation"("workspaceId");

-- CreateIndex
CREATE INDEX "SimulationScenario_simulationId_status_idx" ON "SimulationScenario"("simulationId", "status");

-- CreateIndex
CREATE INDEX "SimulationScenario_simulationId_idx" ON "SimulationScenario"("simulationId");

-- CreateIndex
CREATE INDEX "SimulationResult_simulationScenarioId_idx" ON "SimulationResult"("simulationScenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "MappingSuggestion_agentRunId_key" ON "MappingSuggestion"("agentRunId");

-- CreateIndex
CREATE INDEX "MappingSuggestion_datasetId_status_idx" ON "MappingSuggestion"("datasetId", "status");

-- CreateIndex
CREATE INDEX "MappingSuggestion_organizationId_idx" ON "MappingSuggestion"("organizationId");

-- CreateIndex
CREATE INDEX "MappingSuggestion_workspaceId_idx" ON "MappingSuggestion"("workspaceId");

-- CreateIndex
CREATE INDEX "MappingSuggestion_importJobId_idx" ON "MappingSuggestion"("importJobId");

-- CreateIndex
CREATE INDEX "MappingSuggestion_columnId_idx" ON "MappingSuggestion"("columnId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "ToolCallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_simulationScenarioId_fkey" FOREIGN KEY ("simulationScenarioId") REFERENCES "SimulationScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCallRecord" ADD CONSTRAINT "ToolCallRecord_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationFinding" ADD CONSTRAINT "InvestigationFinding_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationScenario" ADD CONSTRAINT "SimulationScenario_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationResult" ADD CONSTRAINT "SimulationResult_simulationScenarioId_fkey" FOREIGN KEY ("simulationScenarioId") REFERENCES "SimulationScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingSuggestion" ADD CONSTRAINT "MappingSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingSuggestion" ADD CONSTRAINT "MappingSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingSuggestion" ADD CONSTRAINT "MappingSuggestion_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingSuggestion" ADD CONSTRAINT "MappingSuggestion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingSuggestion" ADD CONSTRAINT "MappingSuggestion_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DatasetColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingSuggestion" ADD CONSTRAINT "MappingSuggestion_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

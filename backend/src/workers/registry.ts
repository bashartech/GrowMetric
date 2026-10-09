import type { Job } from "@prisma/client";
import { failJob } from "../jobs/queue.js";
import { logger } from "../lib/logger.js";
import { processImportDataJob } from "./handlers/import-data.js";
import { processSyncDatabaseJob } from "./handlers/sync-database.js";
import { processRunAnalystJob } from "./handlers/run-analyst.js";
import { processRunInvestigationJob } from "./handlers/run-investigation.js";
import { processRunSimulationJob } from "./handlers/run-simulation.js";
import { processSuggestMappingJob } from "./handlers/suggest-mapping.js";
import { processSendEmailJob } from "./handlers/send-email.js";
import { processRunAnomalyDetectionJob } from "./handlers/run-anomaly-detection.js";
import { processEvaluateAlertRulesJob } from "./handlers/evaluate-alert-rules.js";
import { processGenerateReportJob } from "./handlers/generate-report.js";

export type JobHandler = (job: Job) => Promise<void>;

const REGISTRY: Record<string, JobHandler> = {
  IMPORT_DATA: processImportDataJob,
  SYNC_DATABASE: processSyncDatabaseJob,
  RUN_ANALYST: processRunAnalystJob,
  RUN_INVESTIGATION: processRunInvestigationJob,
  RUN_SIMULATION: processRunSimulationJob,
  SUGGEST_MAPPING: processSuggestMappingJob,
  SEND_EMAIL: processSendEmailJob,
  RUN_ANOMALY_DETECTION: processRunAnomalyDetectionJob,
  EVALUATE_ALERT_RULES: processEvaluateAlertRulesJob,
  GENERATE_REPORT: processGenerateReportJob,
};

export function handlerFor(type: string): JobHandler | null {
  return REGISTRY[type] ?? null;
}

export async function runHandler(job: Job): Promise<void> {
  const handler = handlerFor(job.type);
  if (!handler) {
    await failJob(job.id, `No worker handler is registered for job type "${job.type}".`);
    return;
  }
  try {
    await handler(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job failure.";
    logger.error({ jobId: job.id, type: job.type, error }, "Job handler threw.");
    await failJob(job.id, message);
  }
}
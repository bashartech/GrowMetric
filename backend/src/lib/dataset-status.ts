import type { DatasetStatus } from "@prisma/client";

/**
 * Dataset statuses that analytics may read.
 *
 * `READY_WITH_WARNINGS` belongs here for the same reason it is produced: a
 * warning means the table has reportable gaps, not that its values are
 * untrustworthy. Anything that can compute on data accepts both, so a table
 * with 10% blanks is still analysed, alerted on, and simulated against.
 *
 * This constant exists because the list used to be hand-written in ten places.
 * When the quality gate was relaxed, the service checks were updated but the
 * scheduler that decides which workspaces to scan was not, so workspaces whose
 * only datasets carried warnings silently stopped receiving anomaly scans.
 * One source of truth is the fix; a grep is not.
 */
export const ANALYTICS_READY_STATUSES: DatasetStatus[] = [
  "READY",
  "READY_WITH_WARNINGS",
];

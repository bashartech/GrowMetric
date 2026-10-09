import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { dataSourceRouter } from "./modules/data-sources/data-source.routes.js";
import { datasetRouter } from "./modules/datasets/dataset.routes.js";
import { qualityRouter } from "./modules/data-quality/quality.routes.js";
import { entitlementRouter } from "./modules/entitlements/entitlement.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { importRouter } from "./modules/imports/import.routes.js";
import { organizationRouter } from "./modules/organizations/organization.routes.js";
import { workspaceRouter } from "./modules/workspaces/workspace.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import { dashboardRouter } from "./modules/dashboards/dashboard.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { investigationRouter } from "./modules/investigations/investigation.routes.js";
import { simulationRouter } from "./modules/simulations/simulation.routes.js";
import { mappingRouter } from "./modules/mapping/mapping.routes.js";
import { anomalyRouter } from "./modules/anomalies/anomaly.routes.js";
import recommendationRouter from "./modules/recommendations/routes.js";
import alertRouter from "./modules/alerts/routes.js";
import reportScheduleRouter from "./modules/reports/report-schedule.routes.js";
import notificationRouter from "./modules/notifications/notification.routes.js";
import { reportRouter } from "./modules/reports/report.routes.js";

export function createApp(): express.Express {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: express.Request) => req.id,
    }),
  );

  app.use("/api/v1", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/organizations", organizationRouter);
  app.use("/api/v1/workspaces", workspaceRouter);
  app.use("/api/v1", entitlementRouter);
  app.use("/api/v1/audit-logs", auditRouter);
  app.use("/api/v1/data-sources", dataSourceRouter);
  app.use("/api/v1/imports", importRouter);
  app.use("/api/v1/datasets", datasetRouter);
  app.use("/api/v1/datasets", qualityRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/dashboards", dashboardRouter);
  app.use("/api/v1/ai", aiRouter);
  app.use("/api/v1/ai", investigationRouter);
  app.use("/api/v1/ai", simulationRouter);
  app.use("/api/v1/ai", mappingRouter);
  app.use("/api/v1/ai/anomalies", anomalyRouter);
app.use("/api/v1/ai/recommendations", recommendationRouter);
app.use("/api/v1/ai", alertRouter);
app.use("/api/v1/ai/reports", reportRouter);
app.use("/api/v1/ai/report-schedules", reportScheduleRouter);
app.use("/api/v1/ai/notifications", notificationRouter);

app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

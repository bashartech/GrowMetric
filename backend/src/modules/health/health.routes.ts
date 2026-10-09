import { Router } from "express";
import { ok } from "../../lib/respond.js";

export const healthRouter = Router();

const VERSION = "1.0.0";

healthRouter.get("/health", (_req, res) => {
  ok(res, {
    status: "ok",
    version: VERSION,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

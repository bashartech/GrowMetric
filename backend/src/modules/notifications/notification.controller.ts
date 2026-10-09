import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { NotificationService } from "./notification.service.js";

const prisma = new PrismaClient();
const notificationService = new NotificationService(prisma);

export const notificationController = {
  list: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const result = await notificationService.list(req.user!.id);
    ok(res, result);
  }),
  markRead: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const result = await notificationService.markRead(req.params.id!, req.user!.id);
    if (!result) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found." } });
      return;
    }
    ok(res, result);
  }),
  markAllRead: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const count = await notificationService.markAllRead(req.user!.id);
    ok(res, { markedAsRead: count });
  }),
};

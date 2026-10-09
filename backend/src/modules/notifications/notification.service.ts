import { PrismaClient } from "@prisma/client";
import { logger } from "../../lib/logger.js";

export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  async list(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" as const },
    });
    return { notifications };
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new Error("Notification not found");
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    logger.info({ notificationId: id }, "Notification marked as read");
    return { notification: updated };
  }

  async markAllRead(userId: string) {
    const count = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    logger.info({ count }, "All notifications marked as read");
    return count;
  }

  async create(userId: string, title: string, body: string) {
    const notification = await this.prisma.notification.create({
      data: { userId, title, body, type: "SYSTEM" },
    });
    logger.info({ notificationId: notification.id }, "Notification created");
    return { notification };
  }

  /**
   * Creates a SYSTEM notification for every user in an organization, so
   * worker/automation events (anomalies, alerts, reports) surface to the org's
   * inbox without a specific recipient user payload on the job.
   */
  async createForOrganization(organizationId: string, title: string, body: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true },
      take: 20,
    });
    if (users.length === 0) {
      logger.debug({ organizationId }, "No users to notify in organization");
      return { count: 0 };
    }
    const result = await this.prisma.notification.createMany({
      data: users.map((user) => ({ userId: user.id, title, body, type: "SYSTEM" })),
    });
    logger.info({ organizationId, count: result.count }, "Notifications created for organization");
    return { count: result.count };
  }
}
